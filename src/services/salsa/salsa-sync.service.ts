import axios from "axios";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { isLocalHostname, isSalsaConfigured, salsaPublisherUrl } from "../../config/salsa.js";
import { getSalsaRuntimeConfig } from "./salsa-config.service.js";
import { persistSalsaLogo } from "./salsa-logo.service.js";
import type { GameType } from "../../../generated/prisma/client.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function mapCategory(category?: string): { slug: string; name: string; gameType: GameType } {
  const c = (category ?? "Slot").toLowerCase();
  if (c.includes("bingo")) return { slug: "bingo", name: "Bingo", gameType: "BINGO" };
  if (c.includes("table") || c.includes("roleta") || c.includes("blackjack")) {
    return { slug: "table", name: "Mesa", gameType: "TABLE" };
  }
  if (c.includes("crash")) return { slug: "crash", name: "Crash", gameType: "CRASH" };
  return { slug: "slots", name: "Slots", gameType: "SLOT" };
}

function resolveSalsaLogo(slug: string, g: SalsaGameJson): string | null {
  return persistSalsaLogo(slug, {
    gameLogoUrl: g.gameLogoUrl ?? g.logo ?? g.imageUrl ?? g.image ?? g.icon ?? null,
    gameLogo: g.gameLogo ?? null,
  });
}

function parseRtp(rtp?: string): number | null {
  if (!rtp) return null;
  const n = Number(String(rtp).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

interface SalsaGameJson {
  gameName: string;
  commercial_name?: string;
  category?: string;
  rtp?: string;
  openurl?: string;
  gameLogoUrl?: string;
  gameLogo?: string;
  tableLimit?: string;
  logo?: string;
  image?: string;
  imageUrl?: string;
  icon?: string;
}

interface SalsaProviderJson {
  providerName: string;
  salsaProviderId?: number;
  games: SalsaGameJson[];
}

const SALSA_PROVIDER_SCAN_MAX = 80;
const SALSA_PROVIDER_EMPTY_STOP = 5;

function catalogBaseUrl(raw: string): URL {
  const url = new URL(raw);
  url.searchParams.delete("provider");
  return url;
}

async function fetchSalsaProviderPage(base: URL, providerId: number): Promise<SalsaProviderJson[]> {
  const url = new URL(base);
  url.searchParams.set("provider", String(providerId));
  try {
    const { data, status } = await axios.get<{ data?: { providers?: SalsaProviderJson[] } }>(url.toString(), {
      timeout: 120_000,
      maxContentLength: 80 * 1024 * 1024,
      maxBodyLength: 80 * 1024 * 1024,
      validateStatus: (s) => s < 500,
    });
    if (status >= 400) return [];
    return (data?.data?.providers ?? []).filter((p) => p?.providerName && (p.games?.length ?? 0) > 0);
  } catch {
    return [];
  }
}

/** A Salsa exige `provider=N` por request. Sem o param a API devolve 400. */
export async function fetchAllSalsaProviders(rawUrl: string): Promise<{
  providers: SalsaProviderJson[];
  scanned: number;
  foundIds: number[];
}> {
  const base = catalogBaseUrl(rawUrl);
  const bySlug = new Map<string, SalsaProviderJson>();
  const foundIds: number[] = [];
  let emptyStreak = 0;
  let scanned = 0;

  for (let id = 1; id <= SALSA_PROVIDER_SCAN_MAX && emptyStreak < SALSA_PROVIDER_EMPTY_STOP; id++) {
    scanned = id;
    const page = await fetchSalsaProviderPage(base, id);
    if (!page.length) {
      emptyStreak += 1;
      continue;
    }
    emptyStreak = 0;
    foundIds.push(id);
    for (const prov of page) {
      const key = slugify(prov.providerName);
    const incoming = (prov.games ?? []).map((g) => ({
        ...g,
        gameName: String(g.gameName ?? "").trim(),
        gameLogo: g.gameLogo ?? (g as { GameLogo?: string }).GameLogo,
        gameLogoUrl: g.gameLogoUrl ?? (g as { GameLogoUrl?: string }).GameLogoUrl,
      }));
      const existing = bySlug.get(key);
      if (!existing) {
        bySlug.set(key, { providerName: prov.providerName, salsaProviderId: id, games: incoming });
        continue;
      }
      const seen = new Set(existing.games.map((g) => g.gameName));
      for (const g of incoming) {
        if (g.gameName && !seen.has(g.gameName)) {
          existing.games.push(g);
          seen.add(g.gameName);
        }
      }
    }
  }

  return { providers: [...bySlug.values()], scanned, foundIds };
}

export async function getSalsaIntegrationStatus() {
  const salsaProviders = await prisma.gameProvider.findMany({
    where: { integration: "SALSA" },
    select: { id: true, isActive: true },
  });
  const providerIds = salsaProviders.map((p) => p.id);
  const gameCount = providerIds.length
    ? await prisma.game.count({ where: { providerId: { in: providerIds } } })
    : 0;

  return {
    enabled: env.SALSA_ENABLED,
    configured: isSalsaConfigured(),
    publisherUrl: salsaPublisherUrl(),
    publisherReachableBySalsa: !isLocalHostname(salsaPublisherUrl()),
    publisherWarning: isLocalHostname(salsaPublisherUrl())
      ? "A Salsa não alcança localhost. Use um túnel (cloudflared/ngrok) e coloque a URL em SALSA_PUBLISHER_URL / cadastre essa URL no painel da Salsa."
      : null,
    pn: env.SALSA_PN ?? null,
    hasHashKey: Boolean(env.SALSA_HASH_KEY),
    gameListUrl: env.SALSA_GAME_LIST_URL ?? null,
    apiBase: env.SALSA_API_BASE,
    defaultCostPct: env.SALSA_DEFAULT_COST_PCT,
    providerActive: salsaProviders.some((p) => p.isActive),
    gamesImported: gameCount,
    missing: [
      !env.SALSA_PN && "SALSA_PN",
      !env.SALSA_HASH_KEY && "SALSA_HASH_KEY",
      !env.SALSA_GAME_LIST_URL && "SALSA_GAME_LIST_URL",
    ].filter(Boolean),
  };
}

export async function syncSalsaGamesFromSource(options?: {
  gameListUrl?: string;
  activateProvider?: boolean;
  defaultCostPct?: number;
}) {
  const cfg = await getSalsaRuntimeConfig();
  const url = options?.gameListUrl ?? cfg.gameListUrl ?? env.SALSA_GAME_LIST_URL;
  if (!url) {
    throw new Error("SALSA_GAME_LIST_URL não configurada — peça a URL do JSON à Salsa");
  }

  const catalog = await fetchAllSalsaProviders(url);
  const providers = catalog.providers;
  if (!providers.length) {
    throw new Error("JSON da Salsa não contém providers — confira a URL / PN");
  }

  try {
    const { upsertSalsaConfig } = await import("./salsa-config.service.js");
    await upsertSalsaConfig({ gameListUrl: catalogBaseUrl(url).toString() });
  } catch {
    /* config table may not exist yet */
  }

  const costPct = options?.defaultCostPct ?? env.SALSA_DEFAULT_COST_PCT;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let logosFromUrl = 0;
  let logosFromBase64 = 0;

  for (const prov of providers) {
    const provSlug = slugify(prov.providerName);

    const provider = await prisma.gameProvider.upsert({
      where: { slug: provSlug },
      create: {
        slug: provSlug,
        name: prov.providerName,
        integration: "SALSA",
        defaultCostPct: costPct,
        isActive: options?.activateProvider ?? false,
      },
      update: {
        name: prov.providerName,
        defaultCostPct: costPct,
        integration: "SALSA",
        ...(options?.activateProvider ? { isActive: true } : {}),
      },
    });

    for (const g of prov.games ?? []) {
      if (!g.gameName) {
        skipped += 1;
        continue;
      }

      const cat = mapCategory(g.category);
      const category = await prisma.gameCategory.upsert({
        where: { slug: cat.slug },
        create: { slug: cat.slug, name: cat.name, sortOrder: 10 },
        update: { name: cat.name },
      });

      const slug = `${provSlug}-${slugify(g.gameName)}`.slice(0, 80);
      const name = g.commercial_name?.trim() || g.gameName;
      const rtp = parseRtp(g.rtp);

      const existing = await prisma.game.findUnique({ where: { slug } });
      const hadBase64 = Boolean(g.gameLogo && String(g.gameLogo).length > 32);
      const thumbnailUrl = resolveSalsaLogo(slug, g);
      if (thumbnailUrl) logosFromUrl += 1;
      else if (hadBase64) logosFromBase64 += 1;

      await prisma.game.upsert({
        where: { slug },
        create: {
          slug,
          name,
          providerId: provider.id,
          categoryId: category.id,
          gameType: cat.gameType,
          engine: "EXTERNAL",
          externalGameId: g.gameName,
          externalUrl: null,
          thumbnailUrl,
          rtp,
          aggregatorFeePct: Number(provider.defaultCostPct ?? costPct),
          isActive: provider.isActive,
        },
        update: {
          name,
          engine: "EXTERNAL",
          externalGameId: g.gameName,
          externalUrl: null,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          rtp: rtp ?? undefined,
          aggregatorFeePct: Number(provider.defaultCostPct ?? costPct),
          ...(options?.activateProvider ? { isActive: true } : {}),
        },
      });

      if (existing) updated += 1;
      else created += 1;
    }
  }

  const categoryIds = [
    ...new Set(
      (
        await prisma.game.findMany({
          where: { engine: "EXTERNAL" },
          select: { categoryId: true },
          distinct: ["categoryId"],
        })
      ).map((g) => g.categoryId),
    ),
  ];

  const { entitleActiveClientsToCategories } = await import("../../entitlements/entitlement.service.js");
  const entitlements = await entitleActiveClientsToCategories(categoryIds);

  let published = { providersActivated: 0, gamesActivated: 0, entitlements };
  if (options?.activateProvider) {
    published = await publishExternalCatalogToClients();
  }

  return {
    created,
    updated,
    skipped,
    providers: providers.length,
    providerIds: catalog.foundIds,
    scannedProviderIds: catalog.scanned,
    providerNames: providers.map((p) => p.providerName),
    logosFromUrl,
    logosFromBase64,
    entitlements,
    published,
  };
}

/** Ativa o catálogo externo e libera as categorias para os operadores B2B. */
export async function publishExternalCatalogToClients() {
  await prisma.gameProvider.updateMany({
    where: {
      OR: [{ integration: "SALSA" }, { games: { some: { engine: "EXTERNAL" } } }],
    },
    data: { isActive: true, integration: "SALSA" },
  });

  await prisma.game.updateMany({
    where: { engine: "EXTERNAL", externalGameId: { not: null } },
    data: { isActive: true },
  });

  const providers = await prisma.gameProvider.findMany({
    where: { integration: "SALSA", isActive: true },
    select: { id: true },
  });

  const categories = await prisma.game.findMany({
    where: { engine: "EXTERNAL", isActive: true },
    select: { categoryId: true },
    distinct: ["categoryId"],
  });

  const { entitleActiveClientsToCategories } = await import("../../entitlements/entitlement.service.js");
  const entitlements = await entitleActiveClientsToCategories(categories.map((c) => c.categoryId));

  const gamesActivated = await prisma.game.count({
    where: { engine: "EXTERNAL", isActive: true },
  });

  return {
    providersActivated: providers.length,
    gamesActivated,
    entitlements,
  };
}

export async function setProviderGamesActive(providerId: number, isActive: boolean) {
  const result = await prisma.game.updateMany({
    where: { providerId },
    data: { isActive },
  });
  await prisma.gameProvider.update({ where: { id: providerId }, data: { isActive } });
  return result;
}

export async function applyProviderCostToGames(providerId: number, costPct: number) {
  await prisma.gameProvider.update({
    where: { id: providerId },
    data: { defaultCostPct: costPct },
  });
  return prisma.game.updateMany({
    where: { providerId },
    data: { aggregatorFeePct: costPct },
  });
}

export async function listSalsaGames(options?: { providerId?: number; search?: string; activeOnly?: boolean }) {
  const providers = await prisma.gameProvider.findMany({
    where: {
      integration: "SALSA",
      ...(options?.providerId && { id: options.providerId }),
    },
    select: { id: true, slug: true, name: true, integration: true, defaultCostPct: true, isActive: true },
  });

  const providerIds = providers.map((p) => p.id);
  if (!providerIds.length) return { providers: [], games: [], total: 0 };

  const games = await prisma.game.findMany({
    where: {
      providerId: { in: providerIds },
      ...(options?.activeOnly && { isActive: true }),
      ...(options?.search && {
        OR: [
          { name: { contains: options.search, mode: "insensitive" } },
          { slug: { contains: options.search, mode: "insensitive" } },
          { externalGameId: { contains: options.search, mode: "insensitive" } },
        ],
      }),
    },
    include: {
      provider: { select: { id: true, slug: true, name: true, integration: true } },
      category: { select: { id: true, slug: true, name: true } },
    },
    orderBy: [{ providerId: "asc" }, { name: "asc" }],
  });

  return {
    providers,
    games: games.map((g) => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      externalGameId: g.externalGameId,
      thumbnailUrl: g.thumbnailUrl,
      rtp: g.rtp ? Number(g.rtp) : null,
      providerCostPct: Number(g.aggregatorFeePct),
      isActive: g.isActive,
      provider: g.provider,
      category: g.category,
    })),
    total: games.length,
  };
}

export async function setGameProviderCost(gameId: number, providerCostPct: number) {
  return prisma.game.update({
    where: { id: gameId },
    data: { aggregatorFeePct: providerCostPct },
    include: { provider: true, category: true },
  });
}

export async function bulkSetProviderCost(input: {
  providerCostPct: number;
  providerId?: number;
  gameIds?: number[];
  integration?: "SALSA" | "DIRECT";
}) {
  const where: { providerId?: number | { in: number[] }; id?: { in: number[] } } = {};

  if (input.gameIds?.length) {
    where.id = { in: input.gameIds };
  } else if (input.providerId) {
    where.providerId = input.providerId;
  } else if (input.integration) {
    const provs = await prisma.gameProvider.findMany({
      where: { integration: input.integration },
      select: { id: true },
    });
    where.providerId = { in: provs.map((p) => p.id) };
  } else {
    throw new Error("Informe providerId, gameIds ou integration");
  }

  const result = await prisma.game.updateMany({
    where,
    data: { aggregatorFeePct: input.providerCostPct },
  });

  return { gamesUpdated: result.count, providerCostPct: input.providerCostPct };
}
