#!/usr/bin/env bash
# DB 마이그레이션 (데몬 머신에서 DB 머신 MySQL 로 원격 적용)
#
#   ENV_FILE=/etc/vchatbot/.env.stage bash deploy/jenkins/migrate.sh [명령]
#
# 명령:
#   apply    - db/migrations/*.sql 중 미적용분을 번호 순서로 적용 (기본)
#   status   - 적용/미적용 목록 출력
#   baseline - 전부 "적용됨"으로만 기록 (실행 안 함) — 덤프 복원 직후 최초 1회
#
# 적용 이력은 대상 DB 의 schema_migrations 테이블에 기록된다.
set -euo pipefail

cd "$(dirname "$0")/../.."   # 레포 루트

ENV_FILE="${ENV_FILE:-}"
if [ -z "$ENV_FILE" ]; then
  for c in ./.env.stage /etc/vchatbot/.env.stage; do
    [ -f "$c" ] && ENV_FILE="$c" && break
  done
fi
if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "[migrate] env 파일을 찾을 수 없습니다. ENV_FILE=<경로> 로 지정하세요" >&2
  exit 1
fi

envval() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r'; }
HOST=$(envval MYSQL_HOST); PORT=$(envval MYSQL_PORT); USER=$(envval MYSQL_USER)
PASS=$(envval MYSQL_PASSWORD); DB=$(envval MYSQL_DATABASE)
: "${PORT:=3306}" "${DB:=vchatbot}"
if [ -z "$HOST" ] || [ -z "$USER" ]; then
  echo "[migrate] $ENV_FILE 에 MYSQL_HOST/MYSQL_USER 가 없습니다" >&2
  exit 1
fi

# mysql 클라이언트: 설치돼 있으면 그대로, 없으면 docker mysql 이미지의 클라이언트 사용
if command -v mysql >/dev/null 2>&1; then
  run_mysql() { MYSQL_PWD="$PASS" mysql -h"$HOST" -P"$PORT" -u"$USER" --default-character-set=utf8mb4 "$@"; }
else
  run_mysql() {
    docker run --rm -i -e MYSQL_PWD="$PASS" mysql:8.4 \
      mysql -h"$HOST" -P"$PORT" -u"$USER" --default-character-set=utf8mb4 "$@"
  }
fi

run_mysql "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
SQL

applied=$(run_mysql -N "$DB" -e "SELECT filename FROM schema_migrations")
is_applied() { echo "$applied" | grep -qxF "$1"; }

cmd="${1:-apply}"
files=$(ls db/migrations/*.sql 2>/dev/null | sort)
[ -n "$files" ] || { echo "[migrate] db/migrations 에 파일이 없습니다"; exit 0; }

case "$cmd" in
  status)
    for f in $files; do
      name=$(basename "$f")
      if is_applied "$name"; then echo "  적용됨   $name"; else echo "  미적용   $name"; fi
    done
    ;;
  baseline)
    for f in $files; do
      name=$(basename "$f")
      is_applied "$name" && continue
      run_mysql "$DB" -e "INSERT INTO schema_migrations (filename) VALUES ('$name')"
      echo "[migrate] baseline 기록: $name"
    done
    echo "[migrate] baseline 완료 (SQL 은 실행하지 않음)"
    ;;
  apply)
    pending=0
    for f in $files; do
      name=$(basename "$f")
      is_applied "$name" && continue
      echo "[migrate] 적용: $name"
      run_mysql "$DB" < "$f"
      run_mysql "$DB" -e "INSERT INTO schema_migrations (filename) VALUES ('$name')"
      pending=$((pending + 1))
    done
    if [ "$pending" -eq 0 ]; then echo "[migrate] 적용할 마이그레이션 없음"; else echo "[migrate] ${pending}건 적용 완료"; fi
    ;;
  *) echo "사용법: migrate.sh [apply|status|baseline]" >&2; exit 2 ;;
esac
