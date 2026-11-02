#!/usr/bin/env bash
# DB 머신에서 백업 폴더 하나로 3종 전부 복원
# 사용법: sudo bash restore-all.sh <백업폴더> [데몬머신IP] [앱계정비밀번호]
set -euo pipefail

DIR=${1:?사용법: restore-all.sh <백업폴더> [데몬머신IP] [앱계정비밀번호]}
APP_HOST=${2:-%}
APP_PW=${3:-vchatbot}
HERE=$(cd "$(dirname "$0")" && pwd)

bash "$HERE/restore-mysql.sh" "$DIR/mysql-vchatbot.sql" "$APP_HOST" "$APP_PW"
bash "$HERE/restore-mongo.sh" "$DIR/mongo-vchatbot.gz"
bash "$HERE/restore-redis.sh" "$DIR/redis-dump.rdb"

echo "전체 복원 완료"
