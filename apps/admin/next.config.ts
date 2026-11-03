import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vchatbot/core", "@vchatbot/story-editor"],
  serverExternalPackages: ["mysql2", "ioredis", "mongodb", "basic-ftp", "@aws-sdk/client-s3", "@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
