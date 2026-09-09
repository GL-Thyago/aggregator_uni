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
 * % Salsa: jogo (cliente) → sócio+provedor → % do provedor → padrão global.
 * Cobrança: jogo (cliente) → sócio+provedor → cobrança do sócio → padrão global.
 */
export async function resolveClientGameFees(input: {
  clientId: string;
  gameId: number;
  categoryId: number;
  providerId?: number;
  defaultProviderCostPct: number;
  defaultClientMarginPct: number;
}): Promise<ResolvedClientGameFees> {
  const [cfg, client, provider, access, gameEnt] = await Promise.all([
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
    prisma.clientEntitlement.findFirst({
      where: { clientId: input.clientId, gameId: input.gameId },
      select: { feePct: true, chargePct: true },
    }),
  ]);

  const globalSalsa = Number(cfg.defaultProviderCostPct) || input.defaultProviderCostPct;
  const providerSalsa = provider?.defaultCostPct != null ? Number(provider.defaultCostPct) : null;
  const accessSalsa = access?.feePct != null ? Number(access.feePct) : null;
  const gameSalsa = gameEnt?.feePct != null ? Number(gameEnt.feePct) : null;
  const providerCostPct = gameSalsa ?? accessSalsa ?? providerSalsa ?? globalSalsa;

  const globalCharge =
    Number(cfg.defaultOperatorChargePct) || roundPct(providerCostPct + input.defaultClientMarginPct);
  const clientCharge = client?.chargePct != null ? Number(client.chargePct) : null;
  const accessCharge = access?.chargePct != null ? Number(access.chargePct) : null;
  const gameCharge = gameEnt?.chargePct != null ? Number(gameEnt.chargePct) : null;
  const totalChargePct = gameCharge ?? accessCharge ?? clientCharge ?? globalCharge;
  const clientMarginPct = Math.max(0, roundPct(totalChargePct - providerCostPct));

  return {
    providerCostPct,
    clientMarginPct,
    totalChargePct,
    gameFeePct: providerCostPct,
    clientFeePct: clientMarginPct,
    chargePctOverride: gameCharge ?? accessCharge ?? clientCharge,
  };
}

function roundPct(n: number) {
  return Math.round(n * 100) / 100;
}
