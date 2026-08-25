import { prisma } from "../lib/prisma.js";

export interface ResolvedClientGameFees {
  /** Repasse ao provedor (Salsa/upstream) — vem de Game.aggregatorFeePct ou override */
  providerCostPct: number;
  /** Sua margem B2B sobre a aposta */
  clientMarginPct: number;
  /** Total debitado do operador (provider + margem) */
  totalChargePct: number;
  /** gameFeePct / clientFeePct usados no spin */
  gameFeePct: number;
  clientFeePct: number;
  /** chargePct explícito no entitlement, se houver */
  chargePctOverride: number | null;
}

async function findEntitlement(clientId: string, gameId: number, categoryId: number) {
  const specific = await prisma.clientEntitlement.findFirst({
    where: { clientId, gameId, isEnabled: true },
    select: { feePct: true, chargePct: true },
  });
  if (specific) return specific;

  return prisma.clientEntitlement.findFirst({
    where: { clientId, categoryId, gameId: null, isEnabled: true },
    select: { feePct: true, chargePct: true },
  });
}

/**
 * Repasse Salsa = Game.aggregatorFeePct (ou entitlement.feePct override).
 * Cobrança cliente = entitlement.chargePct OU marginPct do client + repasse.
 */
export async function resolveClientGameFees(input: {
  clientId: string;
  gameId: number;
  categoryId: number;
  defaultProviderCostPct: number;
  defaultClientMarginPct: number;
}): Promise<ResolvedClientGameFees> {
  const entitlement = await findEntitlement(input.clientId, input.gameId, input.categoryId);

  const providerCostPct =
    entitlement?.feePct !== null && entitlement?.feePct !== undefined
      ? Number(entitlement.feePct)
      : input.defaultProviderCostPct;

  const chargeOverride =
    entitlement?.chargePct !== null && entitlement?.chargePct !== undefined
      ? Number(entitlement.chargePct)
      : null;

  let clientMarginPct: number;
  let totalChargePct: number;

  if (chargeOverride !== null) {
    totalChargePct = chargeOverride;
    clientMarginPct = Math.max(0, roundPct(chargeOverride - providerCostPct));
  } else {
    clientMarginPct = input.defaultClientMarginPct;
    totalChargePct = roundPct(providerCostPct + clientMarginPct);
  }

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
