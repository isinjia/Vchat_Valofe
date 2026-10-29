import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// 모노레포 루트의 .env 를 로드한다.
// Next.js 앱은 apps/web, apps/admin 에서 실행되므로 상위 폴더를 거슬러 올라가며 찾는다.
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export function env(key: string, fallback?: string): string {
  loadEnv();
  const v = process.env[key] ?? fallback;
  if (v === undefined) {
    throw new Error(`환경변수 ${key} 가 설정되지 않았습니다 (.env 확인)`);
  }
  return v;
}
