#!/usr/bin/env bash
# DB 머신(MySQL 직접 설치)에서 실행 — 덤프 복원 + 데몬 머신에서의 원격 접속 계정 생성
# 사용법: bash restore-mysql.sh mysql-vchatbot.sql [데몬머신IP] [앱계정비밀번호]
#   데몬머신IP 를 생략하면 '%'(모든 호스트 허용) — 스테이지라도 가급적 IP 를 지정할 것
set -euo pipefail

SQL_FILE=${1:?사용법: restore-mysql.sh <덤프.sql> [데몬머신IP] [앱계정비밀번호]}
APP_HOST=${2:-%}
APP_PW=${3:-}

read -rsp "MySQL root 비밀번호: " ROOTPW; echo
# 앱 계정 비밀번호: MySQL 8 기본 정책(validate_password MEDIUM) 통과 필요 — 8자 이상 + 대/소문자 + 숫자 + 특수문자
if [ -z "$APP_PW" ]; then
  read -rsp "앱 계정(vchatbot) 비밀번호 [정책: 8자+ 대/소문자+숫자+특수문자]: " APP_PW; echo
fi

# 덤프는 --databases 로 떠서 CREATE DATABASE 포함 — 그대로 흘려 넣으면 된다.
mysql -uroot -p"$ROOTPW" --default-character-set=utf8mb4 < "$SQL_FILE"

mysql -uroot -p"$ROOTPW" <<EOSQL
CREATE USER IF NOT EXISTS 'vchatbot'@'${APP_HOST}' IDENTIFIED BY '${APP_PW}';
GRANT ALL PRIVILEGES ON vchatbot.* TO 'vchatbot'@'${APP_HOST}';
FLUSH PRIVILEGES;
EOSQL

echo "MySQL 복원 완료 (vchatbot@'${APP_HOST}' 접속 허용)"
echo "※ 원격 접속이 안 되면 /etc/mysql/.../mysqld.cnf 의 bind-address 를 내부IP(또는 0.0.0.0)로 바꾸고 재시작할 것"
