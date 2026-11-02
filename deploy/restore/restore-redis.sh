#!/usr/bin/env bash
# DB 머신(Redis 직접 설치)에서 실행 — RDB 스냅샷 복원
# 사용법: sudo bash restore-redis.sh redis-dump.rdb [redis데이터디렉토리]
#   데이터 디렉토리를 생략하면 떠 있는 redis 에 CONFIG GET dir 로 물어본다.
set -euo pipefail

RDB=${1:?사용법: restore-redis.sh <redis-dump.rdb> [데이터디렉토리]}
DATA_DIR=${2:-$(redis-cli CONFIG GET dir | tail -1)}
[ -n "$DATA_DIR" ] || { echo "redis 데이터 디렉토리를 알 수 없습니다. 두 번째 인자로 지정하세요."; exit 1; }

# AOF(appendonly yes) 가 켜져 있으면 기동 시 dump.rdb 를 무시한다 — 복원 전엔 꺼두거나 README 참고
systemctl stop redis-server 2>/dev/null || systemctl stop redis

cp "$RDB" "$DATA_DIR/dump.rdb"
chown redis:redis "$DATA_DIR/dump.rdb" 2>/dev/null || true

systemctl start redis-server 2>/dev/null || systemctl start redis
redis-cli ping

echo "Redis 복원 완료 ($DATA_DIR/dump.rdb)"
echo "※ 외부 접속하려면 redis.conf 의 bind 에 내부IP 추가 + requirepass 설정을 권장 (protected-mode 때문에 비밀번호 없이는 외부접속 거부됨)"
