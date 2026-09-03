import { prisma } from "../lib/prisma.js";
import { getSalsaRuntimeConfig } from "./salsa/salsa-config.service.js";

export interface ResolvedClientGameFees {
  /** Repasse à Salsa — sempre o % padrão global */
  providerCostPct: number;
  /** Sua margem B2B sobre a aposta */
  clientMarginPct: number;
  /** Total debitado do operador */
  totalChargePct: number;
  gameFeePct: number;
  clientFeePct: number;
  chargePctOverride: number | null;
}

/**
 * Salsa % = padrão global (um valor para todos).
 * Cobrança operador = override do cliente, senão o padrão global.
 */
export async function resolveClientGameFees(input: {
  clientId: string;
  gameId: number;
  categoryId: number;
  providerId?: number;
  defaultProviderCostPct: number;
  defaultClientMarginPct: number;
}): Promise<ResolvedClientGameFees> {
  const [cfg, client] = await Promise.all([
    getSalsaRuntimeConfig(),
    prisma.client.findUnique({
      where: { id: input.clientId },
      select: { chargePct: true, marginPct: true },
    }),
  ]);

  const providerCostPct = Number(cfg.defaultProviderCostPct) || input.defaultProviderCostPct;
  const globalCharge = Number(cfg.defaultOperatorChargePct) || roundPct(providerCostPct + input.defaultClientMarginPct);

  const chargeOverride =
    client?.chargePct !== null && client?.chargePct !== undefined ? Number(client.chargePct) : null;

  const totalChargePct = chargeOverride ?? globalCharge;
  const clientMarginPct = Math.max(0, roundPct(totalChargePct - providerCostPct));

  return {
    providerCostPct,
    clientMarginPct,
    totalChargePct,
    gameFeePct: providerCostPct,
    clientFeePct: clientMarginPct,
    chargePctOverride: chargeOverride,
  };
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}
