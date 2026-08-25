import { redis, isRedisReady } from "../../lib/redis.js";

const TTL_ENTITLEMENTS = 60 * 15;

const memoryEntitlements = new Map<string, { keys: Set<string>; expiresAt: number }>();

export const redisKeys = {
  entitlements: (clientId: string) => `entitlements:${clientId}`,
};

export function entitlementCacheKey(categoryId: number, gameId: number): string {
  return `${categoryId}:${gameId}`;
}

export function entitlementCacheKeyCategoryOnly(categoryId: number): string {
  return `${categoryId}:*`;
}

export async function cacheEntitlements(clientId: string, keys: string[]): Promise<void> {
  if (isRedisReady()) {
    const key = redisKeys.entitlements(clientId);
    await redis.del(key);
    if (keys.length > 0) {
      await redis.sadd(key, ...keys);
    }
    await redis.expire(key, TTL_ENTITLEMENTS);
    return;
  }

  memoryEntitlements.set(clientId, {
    keys: new Set(keys),
    expiresAt: Date.now() + TTL_ENTITLEMENTS * 1000,
  });
}

export async function getCachedEntitlements(clientId: string): Promise<string[]> {
  if (isRedisReady()) {
    return redis.smembers(redisKeys.entitlements(clientId));
  }

  const cached = memoryEntitlements.get(clientId);
  if (!cached) return [];
  if (cached.expiresAt < Date.now()) {
    memoryEntitlements.delete(clientId);
    return [];
  }
  return [...cached.keys];
}

export async function invalidateEntitlements(clientId: string): Promise<void> {
  if (isRedisReady()) {
    await redis.del(redisKeys.entitlements(clientId));
  }
  memoryEntitlements.delete(clientId);
}
