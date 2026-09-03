import { prisma } from "../lib/prisma.js";
import { refreshClientEntitlements } from "../entitlements/entitlement.service.js";

export async function getPartnerProviderAccess(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, marginPct: true, isActive: true },
  });
  if (!client) return null;

  const providers = await prisma.gameProvider.findMany({
    where: { integration: "SALSA" },
    select: { id: true, slug: true, name: true, isActive: true, defaultCostPct: true },
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
  const marginPct = Number(client.marginPct);

  return {
    client: { ...client, marginPct },
    providers: providers.map((p) => {
      const row = accessById.get(p.id);
      const defaultFee = Number(p.defaultCostPct ?? 6.5);
      const feePct = row?.feePct != null ? Number(row.feePct) : defaultFee;
      const chargePct = row?.chargePct != null ? Number(row.chargePct) : feePct + marginPct;
      return {
        providerId: p.id,
        slug: p.slug,
        name: p.name,
        isActiveGlobal: p.isActive,
        gameCount: totalById.get(p.id) ?? 0,
        activeGameCount: activeById.get(p.id) ?? 0,
        defaultCostPct: defaultFee,
        isEnabled: row?.isEnabled ?? false,
        feePct: row?.feePct != null ? Number(row.feePct) : null,
        chargePct: row?.chargePct != null ? Number(row.chargePct) : null,
        resolvedFeePct: feePct,
        resolvedChargePct: chargePct,
        yourMarginPct: Math.max(0, Math.round((chargePct - feePct) * 10) / 10),
      };
    }),
  };
}

export async function savePartnerProviderAccess(
  clientId: string,
  items: Array<{
    providerId: number;
    isEnabled: boolean;
    feePct?: number | null;
    chargePct?: number | null;
  }>,
) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new Error("Client not found");

  for (const item of items) {
    if (!Number.isInteger(item.providerId) || item.providerId <= 0) continue;
    await prisma.clientProviderAccess.upsert({
      where: { clientId_providerId: { clientId, providerId: item.providerId } },
      create: {
        clientId,
        providerId: item.providerId,
        isEnabled: Boolean(item.isEnabled),
        feePct: item.feePct ?? null,
        chargePct: item.chargePct ?? null,
      },
      update: {
        isEnabled: Boolean(item.isEnabled),
        feePct: item.feePct ?? null,
        chargePct: item.chargePct ?? null,
      },
    });
  }

  await refreshClientEntitlements(clientId);
  return getPartnerProviderAccess(clientId);
}
