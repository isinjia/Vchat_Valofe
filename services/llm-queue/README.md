# llm-queue (대기열 데몬)

aichat 서버 옆에 두는 작업 대기열. 사내 PC의 워커(`llm-worker`)가 롱폴링으로 작업을 가져가 LM Studio로 처리하고 결과를 되돌려준다. 외부 의존성 없음(node:http).

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| QUEUE_PORT | | 8600 | 리슨 포트 |
| QUEUE_WORKER_TOKEN | 필수 | - | 워커 인증 토큰 (`/worker/*`) |
| QUEUE_CLIENT_TOKEN | | - | 설정 시 `/v1` 호출에 `Authorization: Bearer` 요구 |
| QUEUE_MAX_PENDING | | 100 | 대기열 최대 길이 (초과 시 503) |
| QUEUE_WAIT_TIMEOUT_MS | | 180000 | 작업 생성부터 응답 완료까지 전체 한도 |
| QUEUE_STALL_TIMEOUT_MS | | 60000 | 처리 시작 후 청크 무소식 한도 |

## 실행

```
set QUEUE_WORKER_TOKEN=비밀값
npm run start:queue      # 개발: npm run dev:queue
```

`GET /healthz` 로 상태 확인 (`{ok, pending, processing}`).

## admin 등록

LLM 관리에서 provider = OpenAI 호환, base_url = `http://<대기열호스트>:8600/v1`, API Key = `QUEUE_CLIENT_TOKEN` 값.

## 워커 프로토콜

- `GET /worker/jobs/next?wait=N` : 작업 있으면 `{id, payload}`, 없으면 N초(기본 25, 최대 30) 후 204
- `POST /worker/jobs/{id}/chunks` `{seq, content}` : 410 이면 워커는 작업 포기
- `POST /worker/jobs/{id}/done` `{finish_reason, usage:{prompt_tokens, completion_tokens}}`
- `POST /worker/jobs/{id}/error` `{message}`
