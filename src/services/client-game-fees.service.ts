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

function roundPct(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * % Salsa: jogo (cliente) → sócio+provedor → % do provedor → padrão global.
 * Cobrança do operador = override explícito, senão Salsa + margem do sócio.
 * Margem 0 (ex.: Luck) = cobra somente a Salsa daquele jogo.
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

  const globalSalsa = Number(cfg.defaultProviderCostPct) || 0;
  const providerSalsa = provider?.defaultCostPct != null ? Number(provider.defaultCostPct) : null;
  const catalogSalsa = Number.isFinite(input.defaultProviderCostPct) ? input.defaultProviderCostPct : null;
  const accessSalsa = access?.feePct != null ? Number(access.feePct) : null;
  const gameSalsa = gameEnt?.feePct != null ? Number(gameEnt.feePct) : null;
  const providerCostPct = gameSalsa ?? accessSalsa ?? catalogSalsa ?? providerSalsa ?? globalSalsa;

  const clientMargin =
    client?.marginPct != null ? Number(client.marginPct) : Number(input.defaultClientMarginPct) || 0;
  const derivedCharge = roundPct(providerCostPct + clientMargin);

  const clientCharge = client?.chargePct != null ? Number(client.chargePct) : null;
  const accessCharge = access?.chargePct != null ? Number(access.chargePct) : null;
  const gameCharge = gameEnt?.chargePct != null ? Number(gameEnt.chargePct) : null;
  const totalChargePct = gameCharge ?? accessCharge ?? clientCharge ?? derivedCharge;
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
