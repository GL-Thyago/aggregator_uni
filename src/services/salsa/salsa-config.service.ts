import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";

export interface SalsaRuntimeConfig {
  enabled: boolean;
  publisherName: string | null;
  hashKey: string | null;
  gameListUrl: string | null;
  apiBase: string;
  defaultProviderCostPct: number;
  defaultOperatorChargePct: number;
  source: "db" | "env";
}

export async function getSalsaRuntimeConfig(): Promise<SalsaRuntimeConfig> {
  const row = await prisma.salsaIntegrationConfig.findUnique({ where: { id: 1 } });

  if (row) {
    const pn = process.env.SALSA_PN || row.publisherName || env.SALSA_PN || null;
    const hashKey = process.env.SALSA_HASH_KEY || row.hashKey || env.SALSA_HASH_KEY || null;
    const gameListUrl = process.env.SALSA_GAME_LIST_URL || row.gameListUrl || env.SALSA_GAME_LIST_URL || null;
    const apiBase = process.env.SALSA_API_BASE || row.apiBase || env.SALSA_API_BASE;
    return {
      enabled: env.SALSA_ENABLED || row.enabled,
      publisherName: pn,
      hashKey,
      gameListUrl,
      apiBase,
      defaultProviderCostPct: Number(row.defaultProviderCostPct) || env.SALSA_DEFAULT_COST_PCT,
      defaultOperatorChargePct: Number(row.defaultOperatorChargePct) || 20,
      source: process.env.SALSA_PN || process.env.SALSA_GAME_LIST_URL ? "env" : "db",
    };
  }

  return {
    enabled: env.SALSA_ENABLED,
    publisherName: env.SALSA_PN ?? null,
    hashKey: env.SALSA_HASH_KEY ?? null,
    gameListUrl: env.SALSA_GAME_LIST_URL ?? null,
    apiBase: env.SALSA_API_BASE,
    defaultProviderCostPct: env.SALSA_DEFAULT_COST_PCT,
    defaultOperatorChargePct: 20,
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
  defaultOperatorChargePct?: number;
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
      defaultOperatorChargePct: input.defaultOperatorChargePct ?? 20,
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
      ...(input.defaultOperatorChargePct !== undefined && {
        defaultOperatorChargePct: input.defaultOperatorChargePct,
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
      defaultOperatorChargePct: 20,
    },
  });
}
