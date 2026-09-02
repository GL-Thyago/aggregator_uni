import path from "node:path";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { decimalToString } from "../lib/utils.js";
import type { SyncGamesResponse } from "../types/index.js";

type GameWithRelations = {
  id: number;
  slug: string;
  name: string;
  categoryId: number;
  providerId: number;
  gameType: string;
  engine: string;
  assetPath: string | null;
  externalUrl: string | null;
  externalGameId: string | null;
  thumbnailUrl?: string | null;
  sortOrder?: number;
  rtp: unknown;
  minBet: unknown;
  maxBet: unknown;
  aggregatorFeePct: unknown;
  isFeatured: boolean;
  category: { id: number; slug: string; name: string };
  provider: { id: number; slug: string; name: string };
};

export function resolveGamesDir(): string {
  return path.resolve(process.cwd(), env.GAMES_DIR);
}

/** Jogos de provedor externo (Salsa etc.) — launch via sessão, não via URL estática. */
export function isExternalLaunchGame(game: {
  engine: string;
  externalGameId?: string | null;
}): boolean {
  return game.engine === "EXTERNAL" && Boolean(game.externalGameId);
}

export function buildLaunchUrl(game: {
  slug: string;
  assetPath: string | null;
  externalUrl: string | null;
  engine: string;
  externalGameId?: string | null;
}): string {
  if (isExternalLaunchGame(game)) {
    return `${env.PUBLIC_BASE_URL}/api/v1/games/${game.slug}/launch`;
  }
  if (game.externalUrl) return game.externalUrl;
  if (game.assetPath) {
    return `${env.PUBLIC_BASE_URL}/games/${game.assetPath}/index.html`;
  }
  return `${env.PUBLIC_BASE_URL}/api/v1/games/${game.slug}/launch`;
}

export function resolveThumbnailUrl(game: {
  slug: string;
  assetPath?: string | null;
  thumbnailUrl?: string | null;
}): string | null {
  const thumb = game.thumbnailUrl?.trim() ?? "";
  if (/^https?:\/\//i.test(thumb) && !/^data:/i.test(thumb)) return thumb;
  if (/^data:image\//i.test(thumb)) {
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
    return `${base}/api/v1/media/cover/${encodeURIComponent(game.slug)}`;
  }
  return null;
}

export function toClientGameDto(g: GameWithRelations) {
  const external = isExternalLaunchGame(g);
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    category: g.category.slug,
    categorySlug: g.category.slug,
    categoryName: g.category.name,
    categoryId: g.categoryId,
    thumbnailUrl: resolveThumbnailUrl(g),
    isFeatured: g.isFeatured,
    sortOrder: g.sortOrder,
    provider: g.provider.name,
    providerName: g.provider.name,
    providerSlug: g.provider.slug,
    gameType: g.gameType,
    playMode: external ? ("external" as const) : ("embedded" as const),
    ...(g.rtp !== undefined ? { rtp: decimalToString(g.rtp) } : {}),
    ...(g.minBet !== undefined ? { minBet: decimalToString(g.minBet) } : {}),
    ...(g.maxBet !== undefined ? { maxBet: decimalToString(g.maxBet) } : {}),
  };
}

export async function listGamesForClient(clientId: string, allowedGameIds: number[]) {
  if (!allowedGameIds.length) return [];

  return prisma.game.findMany({
    where: {
      id: { in: allowedGameIds },
      isActive: true,
      engine: "EXTERNAL",
      externalGameId: { not: null },
      provider: { isActive: true, integration: "SALSA" },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      categoryId: true,
      providerId: true,
      gameType: true,
      engine: true,
      assetPath: true,
      externalUrl: true,
      externalGameId: true,
      thumbnailUrl: true,
      isFeatured: true,
      sortOrder: true,
      category: { select: { id: true, slug: true, name: true } },
      provider: { select: { id: true, slug: true, name: true } },
    },
    orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function syncGamesForClient(clientId: string): Promise<SyncGamesResponse> {
  const { getAllowedGameIds } = await import("../entitlements/entitlement.service.js");
  const allowedGameIds = await getAllowedGameIds(clientId);
  const games = await listGamesForClient(clientId, allowedGameIds);

  return {
    count: games.length,
    syncedAt: new Date().toISOString(),
    games: games.map((g) => {
      const dto = toClientGameDto(g);
      return {
        id: dto.id,
        slug: dto.slug,
        name: dto.name,
        categoryId: dto.categoryId,
        categorySlug: dto.categorySlug,
        categoryName: dto.categoryName,
        providerId: g.providerId,
        providerSlug: g.provider.slug,
        providerName: dto.providerName,
        gameType: dto.gameType,
        engine: g.engine,
        launchUrl: buildLaunchUrl(g),
        thumbnailUrl: dto.thumbnailUrl,
        rtp: dto.rtp,
        minBet: dto.minBet,
        maxBet: dto.maxBet,
        aggregatorFeePct: decimalToString(g.aggregatorFeePct),
        isFeatured: dto.isFeatured,
      };
    }),
  };
}

export async function getGameBySlug(slug: string) {
  const include = { category: true, provider: true } as const;
  const bySlug = await prisma.game.findUnique({ where: { slug }, include });
  if (bySlug) return bySlug;
  return prisma.game.findFirst({
    where: { externalGameId: slug, isActive: true },
    include,
  });
}
