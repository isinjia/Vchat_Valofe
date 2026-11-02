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
curl -kI https://localhost:${WEB_TLS_PORT}/    # 채팅 서버 (nginx TLS)
curl -kI https://localhost:${ADMIN_TLS_PORT}/  # 관리툴 (nginx TLS)
docker compose -f deploy/docker/docker-compose.stage.yml logs -f web
```

## HTTPS 구성 (nginx 컨테이너 — 호스트 설치 금지)

이 VM 은 OS 패키지 업데이트를 잠가둔 머신이라(dnf excludepkgs) **호스트에 nginx 를 설치하지 않는다.**
compose 의 `nginx` 서비스(이미지 버전 고정)가 포트별로 TLS 만 종료한다:

- 도메인은 vmsg-center-stage.valofe.com 하나를 그대로 쓰고 **포트로 나눈다** (80/443, vhost 없음):
  `https://<도메인>:5000` → web, `https://<도메인>:5001` → admin (`.env.stage` 의 `WEB_TLS_PORT`/`ADMIN_TLS_PORT` —
  기존 HTTP 시절 포트를 TLS 로 승계해 주소 유지)
- 원본 HTTP 포트는 호스트에 공개되지 않는다 — compose 내부 네트워크 전용. 평문 진입로 없음.
  web 의 내부 포트는 3000 이 아니라 **5000** (서버 머신 호스트의 다른 3000 프로세스와 혼동 방지).
- 인증서: VMessage 와 공용 `*.valofe.com` — `/opt/vmsg/certs` (cert.pem/key.pem) 를 **읽기 전용** 마운트.
  이 파일들의 소유자/권한(uid 1000, 600)은 절대 바꾸지 말 것 (VMessage 가 그 설정으로 읽는다).
- 새 TLS 포트의 방화벽 개방은 수동 (관리자가 직접).
- nginx 뒤에서는 앱이 보는 접속 IP 가 컨테이너 주소다 — 허용 IP 류(VMsg 콜백 등)는 X-Forwarded-For 기준으로 동작하며
  nginx 가 그 헤더를 채워준다. 같은 머신의 VMessage 컨테이너가 보내는 콜백은 출발 IP 가 도커 브리지로 보일 수 있으니
  IP 허용은 보조로만 쓰고 서명 검증(HMAC)을 기본으로 한다 (콜백 구현이 이미 그렇게 되어 있음).

포트 변경은 `.env.stage` 의 `WEB_TLS_PORT` / `ADMIN_TLS_PORT` 만 바꾸고 `up -d` 재실행 (재빌드 불필요).
VMessage 사용 포트 4000/4002/4100/8443/8444/8080/9443 은 피할 것.

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

충돌 포인트 (VMessage 쪽과 2026-11-02 상호 확인 완료):

- **포트**: VMessage 사용 포트 = 8443/8444(TLS 소켓), 4000/4002(웹 API), 4100(관리자), 8080(Jenkins), 9443(예약). `WEB_TLS_PORT`/`ADMIN_TLS_PORT` 는 이들만 피하면 됨 (5000/5001 무충돌 확인). 호스트 3000 은 다른 프로세스가 사용 중 — 우리는 안 씀.
- **TLS**: VMessage 는 자체 TLS(노드가 /opt/vmsg/certs 로 직접 처리), 우리는 compose 내 nginx 컨테이너 — 위 "HTTPS 구성" 절. VMessage 포트를 nginx 뒤로 넣지 말 것 (8443/8444 는 HTTP 아님, 4000/4100 프록시 시 그쪽 IP 제한이 깨짐).
- **Redis**: VMessage 는 DB 0 + "VMSG:" 접두 키만 사용. 우리는 DB 1 (`redis://host:6379/1`). Pub/Sub 채널은 DB 번호와 무관하게 전역 공유라 "VMSG:" 로 시작하는 채널명은 금지 (현재 Pub/Sub 미사용이라 해당 없음).
- **MySQL**: VMessage 스키마는 vfun_launcher_center 뿐 — vchatbot 무충돌. 계정(vmsg) 재사용 여부는 운영 판단 (공유하면 비밀번호 유출 시 양쪽이 같이 열림).
- **Jenkins/docker (같은 인스턴스 공유)**: 전역 파급 명령 금지 — `docker system prune -a`, `docker container prune`, `-p` 없는 `docker compose down` 은 VMessage 컨테이너/롤백 이미지를 지울 수 있다. 우리 파이프라인은 `docker image prune -f`(dangling 만)까지만 사용. VMessage 빌드(vmsg-stage 잡)와 동시 빌드는 피할 것 — Jenkins 실행기(executor) 수를 1로 두면 자동으로 직렬화된다.

## 주의

- `SESSION_SECRET` 은 반드시 개발값(dev-secret-change-me)이 아닌 랜덤값으로. 바꾸면 기존 세션 쿠키는 전부 무효화된다(재로그인).
- `APP_ENV=stage` — vfun 인증이 스테이지 인증서버를 쓰도록 하는 값.
- MySQL 데이터의 DATETIME 은 타임존 변환 없이 그대로 복원된다. 개발 컨테이너와 같은 UTC 로 두는 것을 권장.
- 관리툴 TLS 포트(`ADMIN_TLS_PORT`, 기본 5001)는 방화벽에서 사내 IP 만 열 것 (유저용 `WEB_TLS_PORT` 와 달리 외부 개방 금지).
