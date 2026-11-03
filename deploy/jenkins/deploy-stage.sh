#!/usr/bin/env bash
# 스테이지 배포 스크립트 (데몬 머신에서 실행 — Jenkins 또는 수동)
#
#   ENV_FILE=/etc/vchatbot/.env.stage bash deploy/jenkins/deploy-stage.sh [단계]
#
# 단계: build-web | build-admin | up | health | prune | all(기본)
# 4코어 공유 머신(VMessage 동거) 기준으로 web → admin 을 순차 빌드한다.
set -euo pipefail

cd "$(dirname "$0")/../.."   # 레포 루트

# env 파일: $ENV_FILE → 레포 루트 .env.stage → /etc/vchatbot/.env.stage 순서로 탐색
ENV_FILE="${ENV_FILE:-}"
if [ -z "$ENV_FILE" ]; then
  for c in ./.env.stage /etc/vchatbot/.env.stage; do
    [ -f "$c" ] && ENV_FILE="$c" && break
  done
fi
if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "[deploy] env 파일을 찾을 수 없습니다. ENV_FILE=<경로> 로 지정하세요 (예: /etc/vchatbot/.env.stage)" >&2
  exit 1
fi
echo "[deploy] env: $ENV_FILE"

# compose 의 서비스 env_file 에도 같은 파일이 들어가도록 절대경로로 export
# (compose yml 의 env_file: ${ENV_FILE:-../../.env.stage} 가 이 값을 쓴다)
export ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

compose() {
  docker compose --env-file "$ENV_FILE" -f deploy/docker/docker-compose.stage.yml "$@"
}

# env 파일에서 포트 읽기 (없으면 기본값)
port_of() {
  local v
  v=$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d ' \r')
  echo "${v:-$2}"
}

health_one() { # health_one <이름> <TLS포트>
  local name="$1" port="$2" code i
  for i in $(seq 1 30); do
    # nginx 컨테이너가 TLS 종료 — 인증서 CN 과 localhost 가 달라 -k 로 검증 생략
    code=$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost:${port}/" || true)
    if [ -n "$code" ] && [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
      echo "[health] $name OK (:$port → $code)"
      return 0
    fi
    sleep 2
  done
  echo "[health] $name 실패 (:$port 응답 없음/5xx) — 로그 확인: compose logs $name" >&2
  compose logs --tail 50 nginx >&2 || true
  compose logs --tail 50 "$name" >&2 || true
  return 1
}

# bind-mount 된 nginx conf 변경은 컨테이너 재생성을 유발하지 않으므로 매 배포 reload 로 반영
# (문법 검사 통과 시에만 reload — 실패하면 배포를 멈추고 알린다)
reload_nginx() {
  compose exec -T nginx nginx -t
  compose exec -T nginx nginx -s reload
}

step="${1:-all}"
case "$step" in
  build-web)   compose build web ;;
  build-admin) compose build admin ;;
  up)          compose up -d; reload_nginx ;;
  health)
    health_one web   "$(port_of WEB_TLS_PORT 5000)"
    health_one admin "$(port_of ADMIN_TLS_PORT 5001)"
    ;;
  prune)       docker image prune -f ;;
  all)
    compose build web
    compose build admin
    compose up -d
    reload_nginx
    health_one web   "$(port_of WEB_TLS_PORT 5000)"
    health_one admin "$(port_of ADMIN_TLS_PORT 5001)"
    docker image prune -f
    echo "[deploy] 완료"
    ;;
  *) echo "사용법: deploy-stage.sh [build-web|build-admin|up|health|prune|all]" >&2; exit 2 ;;
esac
