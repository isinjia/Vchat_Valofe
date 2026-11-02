#!/usr/bin/env bash
# DB 머신(MongoDB 직접 설치)에서 실행 — 채팅 로그 복원 (기존 vchatbot DB 는 드롭 후 교체)
# 사용법: bash restore-mongo.sh mongo-vchatbot.gz
set -euo pipefail

ARCHIVE=${1:?사용법: restore-mongo.sh <mongo-vchatbot.gz>}

mongorestore --gzip --archive="$ARCHIVE" --nsInclude='vchatbot.*' --drop

echo "MongoDB 복원 완료 (vchatbot)"
echo "※ 데몬 머신에서 붙으려면 /etc/mongod.conf 의 net.bindIp 에 내부IP 를 추가하고 재시작할 것"
