# llm-worker (로컬 프로세싱 데몬)

사내 PC에서 실행. outbound 만으로 대기열 데몬(`llm-queue`)을 롱폴링하여 작업을 가져오고, LM Studio 로 처리한 결과를 청크 단위로 되돌려준다. 외부 의존성 없음.

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| QUEUE_URL | 필수 | - | 대기열 데몬 주소 (예 `http://1.2.3.4:8600`) |
| QUEUE_WORKER_TOKEN | 필수 | - | 대기열의 QUEUE_WORKER_TOKEN 과 동일 |
| LMSTUDIO_URL | | http://127.0.0.1:1234/v1 | LM Studio OpenAI 호환 주소 |
| LMSTUDIO_API_KEY | | - | LM Studio API 키 |
| LMSTUDIO_MODEL | | - | 설정 시 작업의 model 대신 사용 |
| WORKER_CONCURRENCY | | 1 | 동시 처리 작업 수 |

## 실행

```
set QUEUE_URL=http://1.2.3.4:8600
set QUEUE_WORKER_TOKEN=비밀값
npm run worker
```

Ctrl+C(SIGINT) 시 새 폴링을 멈추고 진행 중 작업을 마친 뒤 종료한다. 대기열이 410을 반환하면(취소/만료) LM Studio 요청을 abort 하고 작업을 포기한다.

## admin 등록

워커가 아니라 **대기열**을 등록한다: provider = OpenAI 호환, base_url = `http://<대기열호스트>:8600/v1`, API Key = `QUEUE_CLIENT_TOKEN` 값.
