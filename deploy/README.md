# 스테이지 배포 가이드

## 구성

| 머신 | 역할 | 방식 |
|---|---|---|
| DB 머신 | MySQL · MongoDB · Redis | 서버에 직접 설치한 프로세스 (도커 아님) |
| 데몬 머신 | 채팅 서버(web) · 관리툴(admin) | 도커, Next.js **release 모드**(next build + next start) |

이미지 업로드는 S3/FTP 외부 스토리지(관리툴 설정)라 파일 이관이 따로 없다.
옮길 데이터는 MySQL(메타/설정) + MongoDB(채팅 로그) + Redis(컨텍스트 캐시) 3종.

권장 버전: MySQL 8.0+ (개발은 8.4), MongoDB 7.x 또는 8.0 (개발은 7.0 — 구버전 덤프를 신버전에 복원하는 건 지원됨, mongodb-database-tools 별도 설치), Redis 7.x, Docker + compose v2.

---

## 1. 로컬에서 백업 뜨기 (개발 PC, docker "aichat" 떠 있는 상태)

```powershell
powershell -File deploy\backup\backup-all.ps1
```

→ `deploy/backup/out/<타임스탬프>/` 에 생성:

- `mysql-vchatbot.sql` — CREATE DATABASE 포함 전체 덤프 (루틴/트리거/이벤트 포함)
- `mongo-vchatbot.gz` — vchatbot DB 아카이브
- `redis-dump.rdb` — RDB 스냅샷
- `restore-*.sh` — 복원 스크립트 동봉 (이 폴더 하나만 보내면 됨)

## 2. DB 머신으로 전송 + 복원

```bash
scp -r out/<타임스탬프> user@DB머신:/tmp/vchatbot-backup
ssh user@DB머신
cd /tmp/vchatbot-backup
sudo bash restore-all.sh . <데몬머신IP> <앱계정비밀번호>
```

개별 실행도 가능: `restore-mysql.sh` / `restore-mongo.sh` / `restore-redis.sh`.
(윈도우에서 복사한 .sh 가 CRLF 로 깨지면: `sed -i 's/\r$//' *.sh`)

복원 후 **외부(데몬 머신) 접속 허용** — 각 데몬 설정에서:

- MySQL: `mysqld.cnf` 의 `bind-address` 를 내부IP 로 (스크립트가 계정/권한은 만들어 줌)
- MongoDB: `/etc/mongod.conf` 의 `net.bindIp` 에 내부IP 추가
- Redis: `redis.conf` 의 `bind` 에 내부IP 추가 + `requirepass` 설정 권장
  (비밀번호 없이 protected-mode 가 외부 접속을 거부한다. AOF 를 쓰고 있었다면 RDB 복원 전에 `appendonly no` 인지 확인)
- 방화벽: 3306/27017/6379 는 **데몬 머신 IP 에서만** 열 것 (공인망 개방 금지)

## 3. 데몬 머신에 앱 올리기

```bash
# 레포 전송 (git clone 또는 rsync — node_modules/.next 는 .dockerignore 로 어차피 제외됨)
git clone <repo> vchatbot && cd vchatbot

# env 작성
cp deploy/.env.stage.example .env.stage
vi .env.stage        # DB머신 IP, 비밀번호, SESSION_SECRET, 포트

# 빌드 + 기동 (release 모드)
docker compose --env-file .env.stage -f deploy/docker/docker-compose.stage.yml up -d --build
```

확인:

```bash
docker compose -f deploy/docker/docker-compose.stage.yml ps
curl -I http://localhost:${WEB_PORT}/        # 채팅 서버
curl -I http://localhost:${ADMIN_PORT}/      # 관리툴
docker compose -f deploy/docker/docker-compose.stage.yml logs -f web
```

## 포트 변경 (채팅 서버 포트는 올리기 직전 확정)

`.env.stage` 의 `WEB_PORT` / `ADMIN_PORT` 만 바꾸고:

```bash
docker compose --env-file .env.stage -f deploy/docker/docker-compose.stage.yml up -d
```

컨테이너 내부 포트(3000/5001)는 고정이고 호스트 매핑만 바뀌므로 재빌드 불필요.

## 코드 업데이트 재배포

```bash
git pull
docker compose --env-file .env.stage -f deploy/docker/docker-compose.stage.yml up -d --build
```

## Jenkins 배포 (데몬 머신 로컬 Jenkins — VMessage 와 같은 방식)

구성 파일: `deploy/Jenkinsfile` (파이프라인) + `deploy/jenkins/deploy-stage.sh` (실제 배포 로직, 단독 실행도 가능) + `deploy/jenkins/migrate.sh` (DB 마이그레이션).

1. **사전 준비** (최초 1회):

   ```bash
   sudo usermod -aG docker jenkins && sudo systemctl restart jenkins   # jenkins 가 docker 사용
   sudo mkdir -p /etc/vchatbot
   sudo cp deploy/.env.stage.example /etc/vchatbot/.env.stage && sudo vi /etc/vchatbot/.env.stage
   sudo chown jenkins /etc/vchatbot/.env.stage && sudo chmod 600 /etc/vchatbot/.env.stage
   ```

   env 를 레포 밖(`/etc/vchatbot/`)에 두는 이유: Jenkins 워크스페이스는 체크아웃마다 갈리는 영역이라 비밀값을 두지 않는다.

2. **Job 생성**: New Item → Pipeline → "Pipeline script from SCM" → 레포 주소/브랜치(main) → Script Path `deploy/Jenkinsfile`. 빌드 트리거는 수동(지금 빌드) 또는 원하면 SCM 폴링.

3. **파이프라인 단계**: DB 마이그레이션 → web 빌드 → admin 빌드 → 기동 → 헬스체크 → 이미지 정리. (web/admin 을 순차 빌드하는 건 4코어 공유 머신 배려 — 위 "머신 공유" 절 참고)

Jenkins 없이 손으로 돌릴 때도 동일하다:

```bash
ENV_FILE=/etc/vchatbot/.env.stage bash deploy/jenkins/deploy-stage.sh        # 전체 (빌드→기동→헬스체크→정리)
ENV_FILE=/etc/vchatbot/.env.stage bash deploy/jenkins/migrate.sh apply      # 마이그레이션만
```

## DB 마이그레이션 (deploy/jenkins/migrate.sh)

`db/migrations/*.sql` 을 번호 순서로 적용하고, 적용 이력을 대상 DB 의 `schema_migrations` 테이블에 기록한다.
데몬 머신에서 `.env.stage` 의 MYSQL_* 값으로 DB 머신에 원격 접속한다 (mysql 클라이언트가 없으면 docker mysql 이미지로 대체).

- `migrate.sh status` — 적용/미적용 목록
- `migrate.sh apply` — 미적용분만 적용 (Jenkins 파이프라인이 매 배포마다 실행; 없으면 그냥 통과)
- `migrate.sh baseline` — **덤프 복원 직후 최초 1회**: 덤프에는 모든 변경이 이미 들어 있으므로, 전 파일을 실행 없이 "적용됨"으로만 기록해 기준점을 만든다. 이걸 빼먹으면 첫 apply 가 이미 반영된 ALTER 를 다시 실행하다 에러가 난다.

## VMessage 스테이지와 머신 공유 시 (4코어/16GB VM 기준)

사용자 적은 스테이지면 스펙은 충분하다. 단 셋만 잡아둘 것:

- **MongoDB 캐시 캡** (`/etc/mongod.conf`) — 기본값이 RAM 절반을 선점하므로 공유 머신에서는 필수:

  ```yaml
  storage:
    wiredTiger:
      engineConfig:
        cacheSizeGB: 2
  ```

- **MySQL buffer pool** — 두 서비스 공용이니 명시: `innodb_buffer_pool_size = 2G` (+ 스왑 2~4GB 활성화 권장)
- **이미지 빌드는 하나씩** — next build 가 CPU/메모리 피크라 web·admin 동시 빌드를 피한다:

  ```bash
  docker compose --env-file .env.stage -f deploy/docker/docker-compose.stage.yml build web
  docker compose --env-file .env.stage -f deploy/docker/docker-compose.stage.yml build admin
  docker compose --env-file .env.stage -f deploy/docker/docker-compose.stage.yml up -d
  ```

충돌 포인트: VMessage 가 4000 포트를 쓰므로 `WEB_PORT`/`ADMIN_PORT` 는 피해서 지정.
Redis 는 키가 섞이지 않게 DB 인덱스 분리 권장 — `.env.stage` 의 `REDIS_URL` 을 `redis://host:6379/1` 처럼.
MySQL 은 스키마가 분리되어 있어 계정만 각자 쓰면 됨 (restore 스크립트는 vchatbot DB 만 만지고 VMessage 쪽은 건드리지 않는다).

## 주의

- `SESSION_SECRET` 은 반드시 개발값(dev-secret-change-me)이 아닌 랜덤값으로. 바꾸면 기존 세션 쿠키는 전부 무효화된다(재로그인).
- `APP_ENV=stage` — vfun 인증이 스테이지 인증서버를 쓰도록 하는 값.
- MySQL 데이터의 DATETIME 은 타임존 변환 없이 그대로 복원된다. 개발 컨테이너와 같은 UTC 로 두는 것을 권장.
- 관리툴(5001)은 외부망에 그대로 열지 말고 사내 IP 제한 또는 리버스프록시 뒤에 둘 것.
