import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import {
  isLocalHostname,
  isSalsaConfigured,
  salsaGameCodeFromOpenUrl,
  salsaPublisherUrl,
} from "../../config/salsa.js";
import { getSalsaRuntimeConfig } from "./salsa-config.service.js";
import { salsaLogoToThumbnail } from "./salsa-logo.service.js";
import { TADA_EXCEL_GAMES } from "./salsa-tada-catalog.js";
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

function pickString(g: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = g[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const [key, value] of Object.entries(g)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (keys.some((k) => k.toLowerCase() === key.toLowerCase())) return value.trim();
  }
  return null;
}

function pickNumericId(g: Record<string, unknown>): string | null {
  for (const key of ["gameId", "gameID", "id", "cmsId", "logoId"]) {
    const value = g[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  }
  return null;
}

function resolveSalsaLogo(g: SalsaGameJson): string | null {
  const rec = g as unknown as Record<string, unknown>;
  const fromSalsa = salsaLogoToThumbnail({
    gameLogoUrl:
      pickString(rec, "gameLogoUrl", "GameLogoUrl", "logo", "imageUrl", "image", "icon", "thumbnail", "thumbnailUrl") ??
      null,
    gameLogo: pickString(rec, "gameLogo", "GameLogo") ?? null,
  });
  if (fromSalsa) return fromSalsa;
  const id = pickNumericId(rec);
  if (id) return `https://cms.salsagator.com/games/${id}.png`;
  return null;
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
  gameId?: string;
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

const CATALOG_CACHE_PATH = path.resolve(process.cwd(), "data", "salsa-catalog-cache.json");
const SCAN_CONCURRENCY = 8;
/** Estúdios fora da faixa baixa (TaDa live = 331). Sem isto o JSON existe mas o cassino fica vazio. */
const EXTRA_SALSA_PROVIDER_IDS = [331];

type SalsaCatalogSnapshot = {
  providers: SalsaProviderJson[];
  scanned: number;
  foundIds: number[];
  fetchedAt?: string;
  fromCache?: boolean;
  rateLimited?: string | null;
};

function catalogUrlHasPn(raw: string): boolean {
  try {
    const pn = new URL(raw).searchParams.get("pn");
    return Boolean(pn && pn.trim());
  } catch {
    return false;
  }
}

/** Produção com PN preenchido tem prioridade no sync (capas do CMS live). Senão usa o JSON de teste. */
function resolveSyncCatalogUrl(preferred?: string | null, fallback?: string | null): string | undefined {
  const live = env.SALSA_GAME_LIST_URL_LIVE?.trim();
  if (preferred?.trim()) return preferred.trim();
  if (live && catalogUrlHasPn(live)) return live;
  return fallback?.trim() || env.SALSA_GAME_LIST_URL || undefined;
}

function catalogBaseUrl(raw: string): URL {
  const url = new URL(raw);
  url.searchParams.delete("provider");
  return url;
}

function applySalsaLogoFlag(url: URL) {
  if (env.SALSA_GAME_LOGO) url.searchParams.set("gameLogo", "true");
  else url.searchParams.delete("gameLogo");
}

function salsaRateLimitMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const msg = "error" in data ? String((data as { error?: unknown }).error ?? "") : "";
  if (/must wait 24h/i.test(msg)) return msg;
  return null;
}

function loadCatalogCache(): SalsaCatalogSnapshot | null {
  try {
    if (!fs.existsSync(CATALOG_CACHE_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(CATALOG_CACHE_PATH, "utf8")) as SalsaCatalogSnapshot;
    if (!Array.isArray(parsed.providers) || !parsed.providers.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCatalogCache(snapshot: SalsaCatalogSnapshot) {
  fs.mkdirSync(path.dirname(CATALOG_CACHE_PATH), { recursive: true });
  fs.writeFileSync(
    CATALOG_CACHE_PATH,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      scanned: snapshot.scanned,
      foundIds: snapshot.foundIds,
      providers: snapshot.providers,
    }),
  );
}

function mergeProviderPage(
  bySlug: Map<string, SalsaProviderJson>,
  page: SalsaProviderJson[],
  providerId: number,
) {
  for (const prov of page) {
    const key = slugify(prov.providerName);
    const incoming = (prov.games ?? []).map((g) => {
      const rec = g as unknown as Record<string, unknown>;
      return {
        ...g,
        gameName: String(g.gameName ?? "").trim(),
        gameLogo: pickString(rec, "gameLogo", "GameLogo") ?? g.gameLogo,
        gameLogoUrl: pickString(rec, "gameLogoUrl", "GameLogoUrl") ?? g.gameLogoUrl,
        gameId: pickNumericId(rec) ?? undefined,
      };
    });
    const existing = bySlug.get(key);
    if (!existing) {
      bySlug.set(key, { providerName: prov.providerName, salsaProviderId: providerId, games: incoming });
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

async function fetchSalsaProviderPage(
  base: URL,
  providerId: number,
): Promise<{ providers: SalsaProviderJson[]; rateLimited?: string }> {
  const url = new URL(base);
  url.searchParams.set("provider", String(providerId));
  applySalsaLogoFlag(url);
  try {
    const { data, status } = await axios.get<{ data?: { providers?: SalsaProviderJson[] }; error?: string }>(
      url.toString(),
      {
        timeout: 12_000,
        maxContentLength: 80 * 1024 * 1024,
        maxBodyLength: 80 * 1024 * 1024,
        validateStatus: (s) => s < 500,
      },
    );
    const limited = salsaRateLimitMessage(data);
    if (limited) return { providers: [], rateLimited: limited };
    if (status >= 400) return { providers: [] };
    return {
      providers: (data?.data?.providers ?? []).filter((p) => p?.providerName && (p.games?.length ?? 0) > 0),
    };
  } catch {
    return { providers: [] };
  }
}

/** A Salsa exige `provider=N` por request. Sem o param a API devolve 400.
 *  IDs não são contínuos (PG Soft=42, Evolution=126…). Parar nos primeiros 400
 *  deixa o cassino só com os estúdios da Salsa. A API também trava 24h após um dump. */
export async function fetchAllSalsaProviders(
  rawUrl: string,
  onProgress?: (info: { phase: string; scanned: number; found: number }) => void,
): Promise<SalsaCatalogSnapshot> {
  const base = catalogBaseUrl(rawUrl);
  const bySlug = new Map<string, SalsaProviderJson>();
  const foundIds: number[] = [];
  const maxId = env.SALSA_PROVIDER_SCAN_MAX;
  let scanned = 0;
  let rateLimited: string | null = null;

  const extraIds = [...new Set(EXTRA_SALSA_PROVIDER_IDS.filter((id) => Number.isInteger(id) && id > 0))];

  async function ingest(id: number) {
    const page = await fetchSalsaProviderPage(base, id);
    scanned = Math.max(scanned, id);
    if (page.rateLimited) {
      rateLimited = page.rateLimited;
      return;
    }
    if (!page.providers.length) return;
    foundIds.push(id);
    mergeProviderPage(bySlug, page.providers, id);
  }

  for (const id of extraIds) {
    if (rateLimited) break;
    await ingest(id);
    onProgress?.({ phase: `provedor ${id} (TaDa/extra)`, scanned, found: foundIds.length });
  }

  for (let start = 1; start <= maxId && !rateLimited; start += SCAN_CONCURRENCY) {
    const ids: number[] = [];
    for (let id = start; id < start + SCAN_CONCURRENCY && id <= maxId; id++) {
      if (!extraIds.includes(id)) ids.push(id);
    }
    if (!ids.length) continue;
    const pages = await Promise.all(ids.map(async (id) => ({ id, ...(await fetchSalsaProviderPage(base, id)) })));
    let batchLimited: string | null = null;
    for (const page of pages) {
      scanned = Math.max(scanned, page.id);
      if (page.rateLimited) batchLimited = page.rateLimited;
      if (!page.providers.length) continue;
      foundIds.push(page.id);
      mergeProviderPage(bySlug, page.providers, page.id);
    }
    if (batchLimited) rateLimited = batchLimited;
    onProgress?.({
      phase: `a varrer providers ${start}–${Math.min(start + SCAN_CONCURRENCY - 1, maxId)}`,
      scanned,
      found: foundIds.length,
    });
  }

  const snapshot: SalsaCatalogSnapshot = {
    providers: [...bySlug.values()],
    scanned,
    foundIds,
    rateLimited,
  };

  if (snapshot.providers.length) {
    const cached = loadCatalogCache();
    if (rateLimited && cached && cached.providers.length > snapshot.providers.length) {
      return {
        ...cached,
        fromCache: true,
        rateLimited,
        scanned: scanned || cached.scanned,
      };
    }
    saveCatalogCache(snapshot);
    return snapshot;
  }

  const cached = loadCatalogCache();
  if (cached) {
    return {
      ...cached,
      fromCache: true,
      rateLimited: rateLimited ?? cached.rateLimited ?? null,
      scanned: scanned || cached.scanned,
    };
  }

  return snapshot;
}

export async function getSalsaIntegrationStatus() {
  const salsaProviders = await prisma.gameProvider.findMany({
    where: { integration: "SALSA" },
    select: { id: true, isActive: true },
  });
  const providerIds = salsaProviders.map((p) => p.id);
  const [gameCount, gamesActive] = providerIds.length
    ? await Promise.all([
        prisma.game.count({ where: { providerId: { in: providerIds } } }),
        prisma.game.count({ where: { providerId: { in: providerIds }, isActive: true } }),
      ])
    : [0, 0];

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
    gameLogo: env.SALSA_GAME_LOGO,
    apiBase: env.SALSA_API_BASE,
    defaultCostPct: env.SALSA_DEFAULT_COST_PCT,
    test: {
      pn: env.SALSA_PN ?? null,
      apiBase: "https://api-test.salsagator.com",
      gameListUrl: env.SALSA_GAME_LIST_URL ?? null,
      hasHashKey: Boolean(env.SALSA_HASH_KEY),
    },
    live: {
      pn: env.SALSA_PN_LIVE ?? null,
      apiBase: "https://api.salsagator.com",
      gameListUrl: env.SALSA_GAME_LIST_URL_LIVE ?? null,
      hasHashKey: Boolean(env.SALSA_HASH_KEY_LIVE || env.SALSA_HASH_KEY),
      ready: Boolean(env.SALSA_PN_LIVE),
    },
    providerActive: salsaProviders.some((p) => p.isActive),
    gamesImported: gameCount,
    gamesActive,
    missing: [
      !env.SALSA_PN && "SALSA_PN",
      !env.SALSA_HASH_KEY && "SALSA_HASH_KEY",
      !env.SALSA_GAME_LIST_URL && "SALSA_GAME_LIST_URL",
    ].filter(Boolean),
  };
}

export async function hideNonSalsaCatalog() {
  await prisma.gameProvider.updateMany({
    where: { integration: { not: "SALSA" } },
    data: { isActive: false },
  });
  await prisma.game.updateMany({
    where: {
      OR: [{ engine: { not: "EXTERNAL" } }, { externalGameId: null }],
    },
    data: { isActive: false },
  });
  await ensureGpiValidationGame();
}

/** Jogo de certificação GPI da Salsa (`game=gpi-validation`). */
export async function ensureGpiValidationGame() {
  const provider = await prisma.gameProvider.upsert({
    where: { slug: "salsa" },
    create: { slug: "salsa", name: "Salsa", integration: "SALSA", isActive: true },
    update: { integration: "SALSA", isActive: true },
  });

  const category = await prisma.gameCategory.upsert({
    where: { slug: "slots" },
    create: { slug: "slots", name: "Slots", sortOrder: 1 },
    update: {},
  });

  return prisma.game.upsert({
    where: { slug: "gpi-validation" },
    create: {
      slug: "gpi-validation",
      name: "GPI Validation",
      providerId: provider.id,
      categoryId: category.id,
      gameType: "SLOT",
      engine: "EXTERNAL",
      externalGameId: "gpi-validation",
      isActive: true,
    },
    update: {
      name: "GPI Validation",
      engine: "EXTERNAL",
      externalGameId: "gpi-validation",
      isActive: true,
      providerId: provider.id,
    },
  });
}

const OSS_PRODUCTION_GAMES: Array<{
  code: string;
  name: string;
  providerSlug: string;
  providerName: string;
  categorySlug: "table" | "slots" | "crash" | "instant";
  gameType: GameType;
}> = [
  {
    code: "evo-oss-xs-monopoly-live",
    name: "Monopoly Live",
    providerSlug: "evolution",
    providerName: "Evolution",
    categorySlug: "table",
    gameType: "TABLE",
  },
  {
    code: "ez-oss-CricketWar",
    name: "Cricket War",
    providerSlug: "ezugi",
    providerName: "Ezugi",
    categorySlug: "table",
    gameType: "TABLE",
  },
  {
    code: "net-oss-Quest2ReturntoElDorado",
    name: "Quest II: Return to El Dorado",
    providerSlug: "netent",
    providerName: "NetEnt",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "ret-oss-atlantis",
    name: "Atlantis",
    providerSlug: "red-tiger",
    providerName: "Red Tiger",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "nl-oss-DJPsycho",
    name: "DJ Psycho",
    providerSlug: "no-limit-city",
    providerName: "No Limit City",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "tada-BombingFishing",
    name: "Bombing Fishing",
    providerSlug: "tada-gaming",
    providerName: "TaDa Gaming",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "tada-Crazy777",
    name: "Crazy777",
    providerSlug: "tada-gaming",
    providerName: "TaDa Gaming",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "tada-BubbleBeauty",
    name: "Bubble Beauty",
    providerSlug: "tada-gaming",
    providerName: "TaDa Gaming",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "znt-slot-geishas-revenge",
    name: "Geisha's Revenge",
    providerSlug: "pg-soft",
    providerName: "PG Soft",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "znt-slot-alchemy-gold",
    name: "Alchemy Gold",
    providerSlug: "pg-soft",
    providerName: "PG Soft",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "znt-slot-anubis-wrath",
    name: "Anubis Wrath",
    providerSlug: "pg-soft",
    providerName: "PG Soft",
    categorySlug: "slots",
    gameType: "SLOT",
  },
  {
    code: "znt-aviator",
    name: "Aviator",
    providerSlug: "spribe",
    providerName: "Spribe",
    categorySlug: "crash",
    gameType: "CRASH",
  },
  {
    code: "znt-mines",
    name: "Mines",
    providerSlug: "spribe",
    providerName: "Spribe",
    categorySlug: "instant",
    gameType: "INSTANT",
  },
  {
    code: "znt-dice",
    name: "Dice",
    providerSlug: "spribe",
    providerName: "Spribe",
    categorySlug: "instant",
    gameType: "INSTANT",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  table: "Mesa",
  slots: "Slots",
  crash: "Crash",
  instant: "Instantâneos",
};

const GAME_TYPE_BY_CATEGORY: Record<string, GameType> = {
  table: "TABLE",
  slots: "SLOT",
  crash: "CRASH",
  instant: "INSTANT",
};

export type SalsaLaunchGameInput = {
  code: string;
  name: string;
  providerSlug: string;
  providerName: string;
  categorySlug: "table" | "slots" | "crash" | "instant";
  gameType: GameType;
  thumbnailUrl?: string | null;
};

function inferSalsaPackMeta(code: string): Pick<
  SalsaLaunchGameInput,
  "providerSlug" | "providerName" | "categorySlug" | "gameType"
> {
  const lower = code.trim().toLowerCase();
  if (lower.startsWith("tada-")) {
    return { providerSlug: "tada-gaming", providerName: "TaDa Gaming", categorySlug: "slots", gameType: "SLOT" };
  }
  if (lower === "znt-aviator") {
    return { providerSlug: "spribe", providerName: "Spribe", categorySlug: "crash", gameType: "CRASH" };
  }
  if (lower === "znt-mines" || lower === "znt-dice") {
    return { providerSlug: "spribe", providerName: "Spribe", categorySlug: "instant", gameType: "INSTANT" };
  }
  if (lower.startsWith("znt-slot-") || lower.startsWith("znt-")) {
    return { providerSlug: "pg-soft", providerName: "PG Soft", categorySlug: "slots", gameType: "SLOT" };
  }
  if (lower.startsWith("evo-")) {
    return { providerSlug: "evolution", providerName: "Evolution", categorySlug: "table", gameType: "TABLE" };
  }
  if (lower.startsWith("ez-")) {
    return { providerSlug: "ezugi", providerName: "Ezugi", categorySlug: "table", gameType: "TABLE" };
  }
  if (lower.startsWith("net-")) {
    return { providerSlug: "netent", providerName: "NetEnt", categorySlug: "slots", gameType: "SLOT" };
  }
  if (lower.startsWith("ret-")) {
    return { providerSlug: "red-tiger", providerName: "Red Tiger", categorySlug: "slots", gameType: "SLOT" };
  }
  if (lower.startsWith("nl-")) {
    return { providerSlug: "no-limit-city", providerName: "No Limit City", categorySlug: "slots", gameType: "SLOT" };
  }
  return { providerSlug: "salsa", providerName: "Salsa", categorySlug: "slots", gameType: "SLOT" };
}

export function normalizeSalsaLaunchGame(raw: {
  code: string;
  name?: string | null;
  providerName?: string | null;
  categorySlug?: string | null;
  thumbnailUrl?: string | null;
}): SalsaLaunchGameInput | null {
  const code = String(raw.code ?? "").trim();
  if (!code || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/.test(code)) return null;
  const inferred = inferSalsaPackMeta(code);
  const categorySlug = (
    ["table", "slots", "crash", "instant"].includes(String(raw.categorySlug))
      ? raw.categorySlug
      : inferred.categorySlug
  ) as SalsaLaunchGameInput["categorySlug"];
  const providerName = raw.providerName?.trim() || inferred.providerName;
  const thumbnailUrl = raw.thumbnailUrl?.trim() || null;
  return {
    code,
    name: raw.name?.trim() || code,
    providerSlug: raw.providerName?.trim() ? slugify(raw.providerName) : inferred.providerSlug,
    providerName,
    categorySlug,
    gameType: GAME_TYPE_BY_CATEGORY[categorySlug] ?? inferred.gameType,
    thumbnailUrl: thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) ? thumbnailUrl : null,
  };
}

/** Cadastra IDs Salsa (e-mail OPS) sem novo deploy. */
export async function upsertSalsaLaunchGames(
  items: SalsaLaunchGameInput[],
  options?: { activate?: boolean },
) {
  const created: string[] = [];
  const updated: string[] = [];
  const activate = options?.activate === true;

  for (const item of items) {
    const provider = await prisma.gameProvider.upsert({
      where: { slug: item.providerSlug },
      create: {
        slug: item.providerSlug,
        name: item.providerName,
        integration: "SALSA",
        isActive: activate,
      },
      update: {
        name: item.providerName,
        integration: "SALSA",
        ...(activate ? { isActive: true } : {}),
      },
    });

    const category = await prisma.gameCategory.upsert({
      where: { slug: item.categorySlug },
      create: {
        slug: item.categorySlug,
        name: CATEGORY_LABELS[item.categorySlug] ?? item.categorySlug,
        sortOrder: item.categorySlug === "table" ? 2 : 1,
      },
      update: {},
    });

    const existing = await prisma.game.findFirst({
      where: { OR: [{ slug: item.code }, { externalGameId: item.code }] },
    });

    if (existing) {
      await prisma.game.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          engine: "EXTERNAL",
          externalGameId: item.code,
          ...(activate ? { isActive: true } : {}),
          providerId: provider.id,
          categoryId: category.id,
          gameType: item.gameType,
          ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
        },
      });
      updated.push(item.code);
    } else {
      await prisma.game.create({
        data: {
          slug: item.code,
          name: item.name,
          providerId: provider.id,
          categoryId: category.id,
          gameType: item.gameType,
          engine: "EXTERNAL",
          externalGameId: item.code,
          isActive: activate,
          thumbnailUrl: item.thumbnailUrl ?? null,
        },
      });
      created.push(item.code);
    }
  }

  return { count: items.length, created, updated };
}

export async function ensureOssProductionGames() {
  return upsertSalsaLaunchGames([...OSS_PRODUCTION_GAMES, ...TADA_EXCEL_GAMES]);
}

export async function syncSalsaGamesFromSource(options?: {
  gameListUrl?: string;
  activateProvider?: boolean;
  defaultCostPct?: number;
  onProgress?: (info: { phase: string; scanned?: number; found?: number }) => void;
}) {
  options?.onProgress?.({ phase: "a ligar à Salsa…" });
  await hideNonSalsaCatalog();

  const cfg = await getSalsaRuntimeConfig();
  const url = resolveSyncCatalogUrl(options?.gameListUrl, cfg.gameListUrl);
  if (!url) {
    throw new Error("SALSA_GAME_LIST_URL não configurada — peça a URL do JSON à Salsa");
  }

  const catalog = await fetchAllSalsaProviders(url, options?.onProgress);
  const providers = catalog.providers;
  if (!providers.length) {
    if (catalog.rateLimited) {
      throw new Error(
        `A Salsa limita o download do catálogo a 1 vez / 24h (${catalog.rateLimited}). Espere o prazo e rode npm run salsa:sync de novo — o scanner agora varre PG Soft, Pragmatic e os demais IDs.`,
      );
    }
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

  options?.onProgress?.({
    phase: `a gravar ${providers.length} provedores no banco…`,
    found: providers.length,
  });

  for (const prov of providers) {
    const provSlug = slugify(prov.providerName);

    const provider = await prisma.gameProvider.upsert({
      where: { slug: provSlug },
      create: {
        slug: provSlug,
        name: prov.providerName,
        integration: "SALSA",
        defaultCostPct: costPct,
        isActive: false,
      },
      update: {
        name: prov.providerName,
        integration: "SALSA",
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
      const launchCode = salsaGameCodeFromOpenUrl(g.openurl) ?? g.gameName.trim();
      const rtp = parseRtp(g.rtp);

      const existing = await prisma.game.findUnique({ where: { slug } });
      const thumbnailUrl = resolveSalsaLogo(g);
      if (thumbnailUrl?.startsWith("data:")) logosFromBase64 += 1;
      else if (thumbnailUrl) logosFromUrl += 1;

      await prisma.game.upsert({
        where: { slug },
        create: {
          slug,
          name,
          providerId: provider.id,
          categoryId: category.id,
          gameType: cat.gameType,
          engine: "EXTERNAL",
          externalGameId: launchCode,
          externalUrl: g.openurl?.trim() || null,
          thumbnailUrl,
          rtp,
          aggregatorFeePct: Number(provider.defaultCostPct ?? costPct),
          isActive: false,
        },
        update: {
          name,
          engine: "EXTERNAL",
          externalGameId: launchCode,
          externalUrl: g.openurl?.trim() || null,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          rtp: rtp ?? undefined,
        },
      });

      if (existing) updated += 1;
      else created += 1;
    }
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
    fromCache: Boolean(catalog.fromCache),
    rateLimited: catalog.rateLimited ?? null,
    published: { providersActivated: 0, gamesActivated: 0 },
  };
}

/** Soft-reset: desliga provedores/jogos Salsa e trava o acesso dos sócios. Não apaga dados. */
export async function deactivateSalsaCatalog() {
  const salsaProviders = await prisma.gameProvider.findMany({
    where: { integration: "SALSA" },
    select: { id: true },
  });
  const providerIds = salsaProviders.map((p) => p.id);

  const providers = await prisma.gameProvider.updateMany({
    where: { integration: "SALSA" },
    data: { isActive: false },
  });

  const games = providerIds.length
    ? await prisma.game.updateMany({
        where: {
          providerId: { in: providerIds },
          NOT: {
            OR: [{ slug: "gpi-validation" }, { externalGameId: "gpi-validation" }],
          },
        },
        data: { isActive: false },
      })
    : { count: 0 };

  await ensureGpiValidationGame();

  const clients = await prisma.client.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  let accessRows = 0;
  for (const client of clients) {
    for (const providerId of providerIds) {
      await prisma.clientProviderAccess.upsert({
        where: { clientId_providerId: { clientId: client.id, providerId } },
        create: { clientId: client.id, providerId, isEnabled: false },
        update: { isEnabled: false },
      });
      accessRows += 1;
    }
  }

  return {
    providersDeactivated: providers.count,
    gamesDeactivated: games.count,
    partnersLocked: clients.length,
    accessRows,
  };
}

/** Emergência: liga o catálogo Salsa inteiro. Prefira ativar um provedor e liberar em Sócios. */
export async function publishExternalCatalogToClients() {
  throw new Error(
    "Publicar tudo foi desativado. Ative um provedor em Integrações e libere no Sócios.",
  );
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

/** Aplica o % Salsa padrão a todos os provedores/jogos Salsa. */
export async function applyGlobalSalsaCost(costPct: number) {
  await prisma.gameProvider.updateMany({
    where: { integration: "SALSA" },
    data: { defaultCostPct: costPct },
  });
  return bulkSetProviderCost({ providerCostPct: costPct, integration: "SALSA" });
}

type SalsaSyncJob = {
  running: boolean;
  phase: string;
  scanned: number;
  found: number;
  error: string | null;
  result: Record<string, unknown> | null;
  startedAt: number | null;
  finishedAt: number | null;
};

const salsaSyncJob: SalsaSyncJob = {
  running: false,
  phase: "idle",
  scanned: 0,
  found: 0,
  error: null,
  result: null,
  startedAt: null,
  finishedAt: null,
};

export function getSalsaCatalogSyncStatus(): SalsaSyncJob {
  return { ...salsaSyncJob };
}

export function startSalsaCatalogSync(options?: {
  gameListUrl?: string;
  activateProvider?: boolean;
  defaultCostPct?: number;
}): SalsaSyncJob {
  if (salsaSyncJob.running) return getSalsaCatalogSyncStatus();

  salsaSyncJob.running = true;
  salsaSyncJob.phase = "a iniciar importação…";
  salsaSyncJob.scanned = 0;
  salsaSyncJob.found = 0;
  salsaSyncJob.error = null;
  salsaSyncJob.result = null;
  salsaSyncJob.startedAt = Date.now();
  salsaSyncJob.finishedAt = null;

  void syncSalsaGamesFromSource({
    gameListUrl: options?.gameListUrl,
    defaultCostPct: options?.defaultCostPct,
    onProgress: (info) => {
      salsaSyncJob.phase = info.phase;
      if (info.scanned != null) salsaSyncJob.scanned = info.scanned;
      if (info.found != null) salsaSyncJob.found = info.found;
    },
  })
    .then((result) => {
      salsaSyncJob.result = result as unknown as Record<string, unknown>;
      salsaSyncJob.phase = "concluído";
      salsaSyncJob.running = false;
      salsaSyncJob.finishedAt = Date.now();
    })
    .catch((err: unknown) => {
      salsaSyncJob.error = err instanceof Error ? err.message : "Sync failed";
      salsaSyncJob.phase = "erro";
      salsaSyncJob.running = false;
      salsaSyncJob.finishedAt = Date.now();
    });

  return getSalsaCatalogSyncStatus();
}
