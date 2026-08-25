import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";

export interface SalsaRuntimeConfig {
  enabled: boolean;
  publisherName: string | null;
  hashKey: string | null;
  gameListUrl: string | null;
  apiBase: string;
  defaultProviderCostPct: number;
  source: "db" | "env";
}

export async function getSalsaRuntimeConfig(): Promise<SalsaRuntimeConfig> {
  const row = await prisma.salsaIntegrationConfig.findUnique({ where: { id: 1 } });

  if (row) {
    return {
      enabled: row.enabled || env.SALSA_ENABLED,
      publisherName: row.publisherName ?? env.SALSA_PN ?? null,
      hashKey: row.hashKey ?? env.SALSA_HASH_KEY ?? null,
      gameListUrl: row.gameListUrl ?? env.SALSA_GAME_LIST_URL ?? null,
      apiBase: row.apiBase || env.SALSA_API_BASE,
      defaultProviderCostPct: Number(row.defaultProviderCostPct),
      source: row.publisherName || row.hashKey ? "db" : "env",
    };
  }

  return {
    enabled: env.SALSA_ENABLED,
    publisherName: env.SALSA_PN ?? null,
    hashKey: env.SALSA_HASH_KEY ?? null,
    gameListUrl: env.SALSA_GAME_LIST_URL ?? null,
    apiBase: env.SALSA_API_BASE,
    defaultProviderCostPct: env.SALSA_DEFAULT_COST_PCT,
    source: "env",
  };
}

export async function upsertSalsaConfig(input: {
  enabled?: boolean;
  publisherName?: string | null;
  hashKey?: string | null;
  gameListUrl?: string | null;
  apiBase?: string;
  defaultProviderCostPct?: number;
}) {
  return prisma.salsaIntegrationConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      enabled: input.enabled ?? false,
      publisherName: input.publisherName ?? null,
      hashKey: input.hashKey ?? null,
      gameListUrl: input.gameListUrl ?? null,
      apiBase: input.apiBase ?? env.SALSA_API_BASE,
      defaultProviderCostPct: input.defaultProviderCostPct ?? env.SALSA_DEFAULT_COST_PCT,
    },
    update: {
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.publisherName !== undefined && { publisherName: input.publisherName }),
      ...(input.hashKey !== undefined && { hashKey: input.hashKey }),
      ...(input.gameListUrl !== undefined && { gameListUrl: input.gameListUrl }),
      ...(input.apiBase !== undefined && { apiBase: input.apiBase }),
      ...(input.defaultProviderCostPct !== undefined && {
        defaultProviderCostPct: input.defaultProviderCostPct,
      }),
    },
  });
}

export async function ensureSalsaConfigSeed() {
  const existing = await prisma.salsaIntegrationConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  return prisma.salsaIntegrationConfig.create({
    data: {
      id: 1,
      enabled: env.SALSA_ENABLED,
      publisherName: env.SALSA_PN ?? null,
      hashKey: env.SALSA_HASH_KEY ?? null,
      gameListUrl: env.SALSA_GAME_LIST_URL ?? null,
      apiBase: env.SALSA_API_BASE,
      defaultProviderCostPct: env.SALSA_DEFAULT_COST_PCT,
    },
  });
}
