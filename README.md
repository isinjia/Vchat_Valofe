# VChatBot

AI 캐릭터 페르소나 채팅 서비스.

## 구조

```
apps/web       유저 채팅 화면 (dev: 3000, 운영: 리버스프록시로 80/443 연결)
apps/admin     관리자 화면 (5001) — 세계관/사전/캐릭터/일러스트/설정 관리
packages/core  공유 모듈 — MySQL/MongoDB/Redis 클라이언트, S3/FTP 스토리지, 프롬프트 빌더
db/schema.sql  MySQL 스키마
```

| 저장소 | 용도 |
|---|---|
| MySQL | 설정, 유저, 세계관, 사전, 캐릭터, 일러스트 메타 |
| MongoDB | 유저×캐릭터 채팅 로그 (`chat_messages`) |
| Redis | 캐릭터 컨텍스트 캐시 |
| S3 / FTP | 일러스트 원본 (관리자 > 설정에서 선택) |

## 시작하기

```bash
# 1. DB 기동 (Docker 사용 시; schema.sql 자동 적용)
docker compose up -d

# 2. 환경변수
copy .env.example .env   # ANTHROPIC_API_KEY 및 DB 접속정보 입력

# 3. 의존성 설치
npm install

# 4. 실행
npm run dev:admin   # http://localhost:5001
npm run dev:web     # http://localhost:3000
```

Docker 를 쓰지 않으면 `db/schema.sql` 을 MySQL 에 직접 적용하세요.

## 운영 배포 (80/443)

web 앱은 3000 포트로 띄우고 nginx 등 리버스프록시에서 80/443 → 3000 으로 연결합니다.
SSE 스트리밍을 위해 프록시에 버퍼링 해제가 필요합니다:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_buffering off;          # SSE 필수
    proxy_read_timeout 300s;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
}
```

## 사용 순서

1. 관리자(5001) > 설정 — S3 또는 FTP 업로드 대상 등록
2. 관리자 > 세계관 — 세계관 생성, 기본 설정/AI 프롬프트/지역·인명·용어 사전 입력
3. 관리자 > 캐릭터 — 캐릭터 생성, 설정/성격/말투/상세 프롬프트/관계 입력, 일러스트 업로드
   - 기본 일러스트: 평소 로테이션으로 노출
   - 조건부 일러스트: 트리거 키워드가 AI 응답에 포함될 때 노출
4. 유저 화면(3000) — 세계 선택 → 캐릭터 선택 → 채팅

## TODO (다음 단계)

- [ ] 유저 로그인/회원가입 (현재는 쿠키 기반 게스트 자동 발급)
- [ ] 관리자 화면 인증 — 추후 통합 관리자 OAuth 연동 예정 (그 전까지는 방화벽으로 5001 차단 권장)
- [ ] 사전 항목이 많아질 때 관련 항목만 골라 넣는 검색(RAG) 도입
- [ ] 일러스트 노출 조건 고도화 (호감도, 장면 태그 등)
- [ ] 채팅 세션 구분(새 대화 시작), 대화 내역 삭제
