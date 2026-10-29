import { getRedis } from "./redis";

/**
 * Redis 조회 캐시. 캐시 미스/Redis 장애 시 loader 로 폴백한다.
 * 목록성 응답(JSON 직렬화 가능)에만 사용할 것.
 * ttlSec <= 0 이면 만료 없는 영구 캐시 — 반드시 변경 지점에서 명시적으로 무효화할 것.
 */
export async function cached<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
  try {
    const hit = await getRedis().get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Redis 장애 시 DB 직행
  }
  const value = await loader();
  try {
    if (ttlSec > 0) {
      await getRedis().set(key, JSON.stringify(value), "EX", ttlSec);
    } else {
      await getRedis().set(key, JSON.stringify(value));
    }
  } catch {
    // 캐시 저장 실패는 무시
  }
  return value;
}

/** 패턴에 맞는 캐시 키 일괄 삭제 (예: "cache:web:chars:*") */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    const redis = getRedis();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // TTL 로 자연 만료
  }
}
