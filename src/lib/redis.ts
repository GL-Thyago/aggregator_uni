import { Redis } from "ioredis";
import { env } from "../config/env.js";

const globalForRedis = globalThis as unknown as { redis?: Redis; redisAvailable?: boolean };

function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectTimeout: 5_000,
  });

  client.on("error", (err: Error) => {
    if (err.message && err.message !== "Connection is closed.") {
      console.error("[Redis] Connection error:", err.message);
    }
  });

  return client;
}

function replaceRedisClient(): Redis {
  const next = createRedisClient();
  globalForRedis.redis = next;
  return next;
}

export let redis = globalForRedis.redis ?? replaceRedisClient();
export let redisAvailable = globalForRedis.redisAvailable ?? false;

export function isRedisReady(): boolean {
  return redisAvailable && redis.status === "ready";
}

export async function connectRedis(): Promise<void> {
  if (isRedisReady()) return;

  const maxAttempts = env.NODE_ENV === "production" ? 5 : 2;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (redis.status === "end" || redis.status === "close") {
        redis = replaceRedisClient();
      }

      await redis.connect();
      await redis.ping();
      redisAvailable = true;
      globalForRedis.redisAvailable = true;
      console.log(`[Redis] Connected (${env.REDIS_URL})`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      redis = replaceRedisClient();

      if (attempt < maxAttempts) {
        console.warn(`[Redis] Tentativa ${attempt}/${maxAttempts} falhou — retry em ${attempt}s...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      `[Redis] Não foi possível conectar em ${env.REDIS_URL}. ` +
        `Detalhe: ${lastError?.message ?? "Connection is closed."}`,
    );
  }

  redisAvailable = false;
  globalForRedis.redisAvailable = false;
  try {
    if (redis.status !== "end" && redis.status !== "close") {
      redis.disconnect(false);
    }
  } catch {
    /* ignore */
  }
  console.warn(
    `[Redis] Indisponível (${env.REDIS_URL}) — continuando sem cache. ` +
      "Para cache: npm run docker:up ou inicie Redis na porta 6380.",
  );
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status === "end" || redis.status === "close") return;
  await redis.quit();
}
