import Redis from "ioredis";
import { env } from "./env";

const g = globalThis as unknown as { __vchatbotRedis?: Redis };

export function getRedis(): Redis {
  if (!g.__vchatbotRedis) {
    g.__vchatbotRedis = new Redis(env("REDIS_URL", "redis://127.0.0.1:6379"), {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
  }
  return g.__vchatbotRedis;
}
