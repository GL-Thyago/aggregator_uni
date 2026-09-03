import { prisma } from "../lib/prisma.js";
import {
  cacheEntitlements,
  entitlementCacheKey,
  entitlementCacheKeyCategoryOnly,
  getCachedEntitlements,
  invalidateEntitlements,
} from "../store/redis/entitlement.store.js";

export async function loadClientEntitlements(clientId: string): Promise<string[]> {
  const cached = await getCachedEntitlements(clientId);
  if (cached.length > 0) return cached;

  const rows = await prisma.clientEntitlement.findMany({
    where: { clientId, isEnabled: true },
    select: { categoryId: true, gameId: true },
  });

  const keys: string[] = [];
  for (const row of rows) {
    if (row.gameId === null) {
      keys.push(entitlementCacheKeyCategoryOnly(row.categoryId));
    } else {
      keys.push(entitlementCacheKey(row.categoryId, row.gameId));
    }
  }

  await cacheEntitlements(clientId, keys);
  return keys;
}

export function isGameEntitled(
  entitlements: string[],
  categoryId: number,
  gameId: number,
): boolean {
  if (entitlements.length === 0) return false;

  const exact = entitlementCacheKey(categoryId, gameId);
  const categoryWildcard = entitlementCacheKeyCategoryOnly(categoryId);

  return entitlements.includes(exact) || entitlements.includes(categoryWildcard);
}

export async function refreshClientEntitlements(clientId: string): Promise<void> {
  await invalidateEntitlements(clientId);
  await loadClientEntitlements(clientId);
}

export async function getAllowedGameIds(clientId: string): Promise<number[]> {
  const accessRows = await prisma.clientProviderAccess.findMany({
    where: { clientId },
    select: { providerId: true, isEnabled: true },
  });

  if (accessRows.length) {
    const allowedProviderIds = accessRows.filter((row) => row.isEnabled).map((row) => row.providerId);
    if (!allowedProviderIds.length) return [];

    const games = await prisma.game.findMany({
      where: {
        isActive: true,
        engine: "EXTERNAL",
        externalGameId: { not: null },
        providerId: { in: allowedProviderIds },
        provider: { isActive: true, integration: "SALSA" },
      },
      select: { id: true },
    });
    return games.map((g) => g.id);
  }

  const rows = await prisma.clientEntitlement.findMany({
    where: { clientId, isEnabled: true },
    select: { categoryId: true, gameId: true },
  });

  const gameIds: number[] = [];

  for (const row of rows) {
    if (row.gameId !== null) {
      gameIds.push(row.gameId);
    } else {
      const games = await prisma.game.findMany({
        where: {
          categoryId: row.categoryId,
          isActive: true,
          engine: "EXTERNAL",
          externalGameId: { not: null },
          provider: { isActive: true, integration: "SALSA" },
        },
        select: { id: true },
      });
      gameIds.push(...games.map((g) => g.id));
    }
  }

  return [...new Set(gameIds)];
}

export async function canClientAccessGame(
  clientId: string,
  game: { id: number; categoryId: number; providerId: number; provider?: { integration?: string } },
): Promise<boolean> {
  const accessRows = await prisma.clientProviderAccess.findMany({
    where: { clientId },
    select: { providerId: true, isEnabled: true },
  });

  if (accessRows.length) {
    return accessRows.some((row) => row.providerId === game.providerId && row.isEnabled);
  }

  const entitlements = await loadClientEntitlements(clientId);
  return isGameEntitled(entitlements, game.categoryId, game.id);
}

/** Libera categorias (wildcard) para todos os operadores ativos — jogos novos passam a aparecer no catálogo. */
export async function entitleActiveClientsToCategories(categoryIds: number[]) {
  const unique = [...new Set(categoryIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return { clients: 0, granted: 0 };

  const clients = await prisma.client.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  let granted = 0;
  for (const client of clients) {
    for (const categoryId of unique) {
      const exists = await prisma.clientEntitlement.findFirst({
        where: { clientId: client.id, categoryId, gameId: null },
      });
      if (exists) {
        if (!exists.isEnabled) {
          await prisma.clientEntitlement.update({
            where: { id: exists.id },
            data: { isEnabled: true },
          });
          granted += 1;
        }
        continue;
      }
      await prisma.clientEntitlement.create({
        data: { clientId: client.id, categoryId, gameId: null, isEnabled: true },
      });
      granted += 1;
    }
    await refreshClientEntitlements(client.id);
  }

  return { clients: clients.length, granted };
}

export async function getEntitledGamesTree(clientId: string) {
  const allowedGameIds = await getAllowedGameIds(clientId);
  if (!allowedGameIds.length) return [];

  const categories = await prisma.gameCategory.findMany({
    where: { isActive: true },
    include: {
      games: {
        where: {
          id: { in: allowedGameIds },
          isActive: true,
          engine: "EXTERNAL",
          externalGameId: { not: null },
          provider: { isActive: true, integration: "SALSA" },
        },
        include: { provider: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return categories.filter((c) => c.games.length > 0);
}
