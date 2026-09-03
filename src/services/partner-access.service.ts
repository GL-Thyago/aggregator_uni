import { prisma } from "../lib/prisma.js";
import { refreshClientEntitlements } from "../entitlements/entitlement.service.js";
import { getSalsaRuntimeConfig } from "./salsa/salsa-config.service.js";

export async function getPartnerProviderAccess(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, marginPct: true, chargePct: true, isActive: true },
  });
  if (!client) return null;

  const cfg = await getSalsaRuntimeConfig();
  const salsaPct = Number(cfg.defaultProviderCostPct);
  const defaultChargePct = Number(cfg.defaultOperatorChargePct);
  const clientChargePct = client.chargePct != null ? Number(client.chargePct) : null;
  const resolvedChargePct = clientChargePct ?? defaultChargePct;

  const providers = await prisma.gameProvider.findMany({
    where: { integration: "SALSA" },
    select: { id: true, slug: true, name: true, isActive: true },
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
      operatorChargePct: defaultChargePct,
    },
    client: {
      ...client,
      marginPct: Number(client.marginPct),
      chargePct: clientChargePct,
      resolvedChargePct,
      yourMarginPct: Math.max(0, Math.round((resolvedChargePct - salsaPct) * 10) / 10),
    },
    providers: providers.map((p) => {
      const row = accessById.get(p.id);
      return {
        providerId: p.id,
        slug: p.slug,
        name: p.name,
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
    chargePct?: number | null;
    providers: Array<{ providerId: number; isEnabled: boolean }>;
  },
) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new Error("Client not found");

  if (input.chargePct !== undefined) {
    const cfg = await getSalsaRuntimeConfig();
    const salsaPct = Number(cfg.defaultProviderCostPct);
    const chargePct = input.chargePct;
    await prisma.client.update({
      where: { id: clientId },
      data: {
        chargePct,
        ...(chargePct != null ? { marginPct: Math.max(0, chargePct - salsaPct) } : {}),
      },
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
      },
      update: {
        isEnabled: Boolean(item.isEnabled),
      },
    });
  }

  await refreshClientEntitlements(clientId);
  return getPartnerProviderAccess(clientId);
}
