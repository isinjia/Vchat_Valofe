import type { NextConfig } from "next";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// 모노레포 루트의 .env 를 Next 프로세스에도 로드한다.
// 서버 코드는 @vchatbot/core 가 런타임에 읽지만, 미들웨어(edge)는 Next 가 기동 시 가진 process.env 만 보므로 여기서 미리 채운다.
// (SESSION_SECRET, DEV_AUTO_LOGIN_UID 등. 이미 있는 값은 덮어쓰지 않는다)
(() => {
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
})();

const nextConfig: NextConfig = {
  transpilePackages: ["@vchatbot/core", "@vchatbot/story-editor"],
  serverExternalPackages: ["mysql2", "ioredis", "mongodb", "basic-ftp", "@aws-sdk/client-s3", "@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
