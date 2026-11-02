# 로컬 개발 DB(docker 프로젝트 "aichat")를 통째로 백업한다.
# 산출물: deploy/backup/out/<타임스탬프>/ 에 mysql 덤프 + mongo 아카이브 + redis dump.rdb
# 사용법(레포 루트에서):  powershell -File deploy/backup/backup-all.ps1
param([string]$OutRoot = "$PSScriptRoot\out")
$ErrorActionPreference = "Stop"

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$dir = Join-Path $OutRoot $ts
New-Item -ItemType Directory -Force $dir | Out-Null

# ---- MySQL ----
# PowerShell 리다이렉트(>)는 인코딩을 깨뜨릴 수 있어 컨테이너 안에서 파일로 덤프 후 docker cp 로 꺼낸다.
Write-Host "[1/3] MySQL 덤프..."
docker exec aichat-mysql-1 sh -c "mysqldump -uroot -proot --databases vchatbot --single-transaction --routines --triggers --events --default-character-set=utf8mb4 --result-file=/tmp/vchatbot.sql"
if (-not $?) { throw "mysqldump 실패" }
docker cp aichat-mysql-1:/tmp/vchatbot.sql (Join-Path $dir "mysql-vchatbot.sql")
docker exec aichat-mysql-1 rm -f /tmp/vchatbot.sql

# ---- MongoDB (채팅 로그) ----
Write-Host "[2/3] MongoDB 덤프..."
docker exec aichat-mongodb-1 mongodump --db vchatbot --gzip --archive=/tmp/mongo-vchatbot.gz --quiet
if (-not $?) { throw "mongodump 실패" }
docker cp aichat-mongodb-1:/tmp/mongo-vchatbot.gz (Join-Path $dir "mongo-vchatbot.gz")
docker exec aichat-mongodb-1 rm -f /tmp/mongo-vchatbot.gz

# ---- Redis ----
Write-Host "[3/3] Redis 스냅샷..."
docker exec aichat-redis-1 redis-cli SAVE | Out-Null
docker cp aichat-redis-1:/data/dump.rdb (Join-Path $dir "redis-dump.rdb")

# 복원 스크립트를 함께 넣어 폴더 하나만 서버로 보내면 되게 한다.
Copy-Item "$PSScriptRoot\..\restore\*.sh" $dir

Write-Host ""
Write-Host "백업 완료: $dir"
Get-ChildItem $dir | Select-Object Name, @{n = "MB"; e = { [math]::Round($_.Length / 1MB, 2) } } | Format-Table -AutoSize
