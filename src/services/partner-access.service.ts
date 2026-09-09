import { prisma } from "../lib/prisma.js";
import { refreshClientEntitlements } from "../entitlements/entitlement.service.js";
import { getSalsaRuntimeConfig } from "./salsa/salsa-config.service.js";

function roundPct(n: number) {
  return Math.round(n * 100) / 100;
}

export async function getPartnerProviderAccess(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, marginPct: true, chargePct: true, isActive: true },
  });
  if (!client) return null;

  const cfg = await getSalsaRuntimeConfig();
  const salsaPct = Number(cfg.defaultProviderCostPct);
  const defaultMarginPct = roundPct(
    Number.isFinite(Number(cfg.defaultOperatorChargePct) - salsaPct)
      ? Math.max(0, Number(cfg.defaultOperatorChargePct) - salsaPct)
      : 5,
  );
  const clientMarginPct = client.marginPct != null ? Number(client.marginPct) : defaultMarginPct;
  const clientChargePct = client.chargePct != null ? Number(client.chargePct) : null;

  const providers = await prisma.gameProvider.findMany({
    where: { integration: "SALSA" },
    select: { id: true, slug: true, name: true, displayName: true, isActive: true, defaultCostPct: true },
    orderBy: { name: "asc" },
  });
  const providerIds = providers.map((p) => p.id);

  const [totals, actives, access] = await Promise.all([
    providerIds.length
      ? prisma.game.groupBy({
          by: ["providerId"],
          where: { providerId: { in: providerIds } },
          _count: { _all: true },
        })
      : [],
    providerIds.length
      ? prisma.game.groupBy({
          by: ["providerId"],
          where: { providerId: { in: providerIds }, isActive: true },
          _count: { _all: true },
        })
      : [],
    prisma.clientProviderAccess.findMany({ where: { clientId } }),
  ]);

  const totalById = new Map(totals.map((row) => [row.providerId, row._count._all]));
  const activeById = new Map(actives.map((row) => [row.providerId, row._count._all]));
  const accessById = new Map(access.map((row) => [row.providerId, row]));

  return {
    defaults: {
      salsaPct,
      operatorMarginPct: defaultMarginPct,
      operatorChargePct: Number(cfg.defaultOperatorChargePct),
    },
    client: {
      ...client,
      marginPct: clientMarginPct,
      chargePct: clientChargePct,
      resolvedChargePct: clientChargePct,
      yourMarginPct: clientMarginPct,
    },
    providers: providers.map((p) => {
      const row = accessById.get(p.id);
      const providerSalsa = p.defaultCostPct != null ? Number(p.defaultCostPct) : salsaPct;
      const salsaOverride = row?.feePct != null ? Number(row.feePct) : null;
      const salsa = salsaOverride ?? providerSalsa;
      const charge = row?.chargePct != null ? Number(row.chargePct) : null;
      const resolvedCharge = charge ?? (clientChargePct != null ? clientChargePct : roundPct(salsa + clientMarginPct));
      const rowMargin = charge != null ? Math.max(0, roundPct(charge - salsa)) : clientMarginPct;
      return {
        providerId: p.id,
        slug: p.slug,
        name: p.displayName?.trim() || p.name,
        sourceName: p.name,
        salsaPct: salsa,
        salsaDefaultPct: providerSalsa,
        salsaFeePct: salsaOverride,
        chargePct: charge,
        marginPct: charge != null ? rowMargin : null,
        resolvedChargePct: resolvedCharge,
        yourMarginPct: rowMargin,
        isActiveGlobal: p.isActive,
        gameCount: totalById.get(p.id) ?? 0,
        activeGameCount: activeById.get(p.id) ?? 0,
        isEnabled: row?.isEnabled ?? false,
      };
    }),
  };
}

export async function savePartnerProviderAccess(
  clientId: string,
  input: {
    marginPct?: number;
    chargePct?: number | null;
    clearGameChargeOverrides?: boolean;
    providers: Array<{
      providerId: number;
      isEnabled: boolean;
      chargePct?: number | null;
      feePct?: number | null;
    }>;
  },
) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new Error("Client not found");

  if (input.marginPct !== undefined || input.chargePct !== undefined) {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        ...(input.marginPct !== undefined && { marginPct: input.marginPct }),
        ...(input.chargePct !== undefined && { chargePct: input.chargePct }),
        ...(input.marginPct !== undefined && { chargePct: null }),
      },
    });
  }

  if (input.clearGameChargeOverrides) {
    await prisma.clientEntitlement.updateMany({
      where: { clientId },
      data: { chargePct: null },
    });
  }

  for (const item of input.providers) {
    if (!Number.isInteger(item.providerId) || item.providerId <= 0) continue;
    await prisma.clientProviderAccess.upsert({
      where: { clientId_providerId: { clientId, providerId: item.providerId } },
      create: {
        clientId,
        providerId: item.providerId,
        isEnabled: Boolean(item.isEnabled),
        chargePct: item.chargePct ?? null,
        feePct: item.feePct ?? null,
      },
      update: {
        isEnabled: Boolean(item.isEnabled),
        ...(item.chargePct !== undefined ? { chargePct: item.chargePct } : {}),
        ...(item.feePct !== undefined ? { feePct: item.feePct } : {}),
      },
    });
  }

  await refreshClientEntitlements(clientId);
  return getPartnerProviderAccess(clientId);
}
