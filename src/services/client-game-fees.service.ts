import { prisma } from "../lib/prisma.js";
import { getSalsaRuntimeConfig } from "./salsa/salsa-config.service.js";

export interface ResolvedClientGameFees {
  providerCostPct: number;
  clientMarginPct: number;
  totalChargePct: number;
  gameFeePct: number;
  clientFeePct: number;
  chargePctOverride: number | null;
}

/**
 * % Salsa: override sócio+provedor → % do provedor → padrão global → % do jogo.
 * Cobrança: override sócio+provedor → cobrança do sócio → padrão global.
 */
export async function resolveClientGameFees(input: {
  clientId: string;
  gameId: number;
  categoryId: number;
  providerId?: number;
  defaultProviderCostPct: number;
  defaultClientMarginPct: number;
}): Promise<ResolvedClientGameFees> {
  const [cfg, client, provider, access] = await Promise.all([
    getSalsaRuntimeConfig(),
    prisma.client.findUnique({
      where: { id: input.clientId },
      select: { chargePct: true, marginPct: true },
    }),
    input.providerId
      ? prisma.gameProvider.findUnique({
          where: { id: input.providerId },
          select: { defaultCostPct: true },
        })
      : Promise.resolve(null),
    input.providerId
      ? prisma.clientProviderAccess.findUnique({
          where: { clientId_providerId: { clientId: input.clientId, providerId: input.providerId } },
          select: { feePct: true, chargePct: true },
        })
      : Promise.resolve(null),
  ]);

  const globalSalsa = Number(cfg.defaultProviderCostPct) || input.defaultProviderCostPct;
  const providerSalsa = provider?.defaultCostPct != null ? Number(provider.defaultCostPct) : null;
  const accessSalsa = access?.feePct != null ? Number(access.feePct) : null;
  const providerCostPct = accessSalsa ?? providerSalsa ?? globalSalsa;

  const globalCharge =
    Number(cfg.defaultOperatorChargePct) || roundPct(providerCostPct + input.defaultClientMarginPct);
  const clientCharge = client?.chargePct != null ? Number(client.chargePct) : null;
  const accessCharge = access?.chargePct != null ? Number(access.chargePct) : null;
  const totalChargePct = accessCharge ?? clientCharge ?? globalCharge;
  const clientMarginPct = Math.max(0, roundPct(totalChargePct - providerCostPct));

  return {
    providerCostPct,
    clientMarginPct,
    totalChargePct,
    gameFeePct: providerCostPct,
    clientFeePct: clientMarginPct,
    chargePctOverride: accessCharge ?? clientCharge,
  };
}

function roundPct(n: number) {
  return Math.round(n * 100) / 100;
}
