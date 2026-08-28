import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { generateApiKey, hashApiKey, serializeBigInt } from "../../../lib/utils.js";
import { adminMiddleware } from "../../../auth/middleware.js";
import { refreshClientEntitlements } from "../../../entitlements/entitlement.service.js";
import { targetRtpFromGame } from "../../../config/rtp.js";
import { resolveTargetRtpForClientGame } from "../../../services/client-game-config.service.js";

const router = Router();

router.use(adminMiddleware);

const createClientSchema = z.object({
  name: z.string().min(2),
  marginPct: z.number().min(0).max(50).default(0),
  billingMode: z.enum(["PREPAID", "POSTPAID"]).default("PREPAID"),
  maxCredit: z.number().min(0).nullable().optional(),
  initialBalance: z.number().min(0).default(0),
  rtpPoolMode: z.enum(["GLOBAL", "PER_CLIENT"]).default("GLOBAL"),
  walletUrl: z.string().url().nullable().optional(),
  walletSecret: z.string().min(8).nullable().optional(),
  entitlements: z.array(
    z.object({
      categoryId: z.number().int(),
      gameId: z.number().int().nullable().optional(),
      feePct: z.number().min(0).max(50).nullable().optional(),
      chargePct: z.number().min(0).max(50).nullable().optional(),
      rtpPct: z.number().min(1).max(99).nullable().optional(),
    }),
  ),
});

router.post("/clients", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const client = await prisma.client.create({
    data: {
      name: parsed.data.name,
      apiKeyHash,
      marginPct: parsed.data.marginPct,
      billingMode: parsed.data.billingMode,
      maxCredit: parsed.data.maxCredit ?? null,
      rtpPoolMode: parsed.data.rtpPoolMode,
      walletUrl: parsed.data.walletUrl ?? null,
      walletSecret: parsed.data.walletSecret ?? null,
      entitlements: {
        create: parsed.data.entitlements.map((e) => ({
          categoryId: e.categoryId,
          gameId: e.gameId ?? null,
          feePct: e.feePct ?? null,
          chargePct: e.chargePct ?? null,
          rtpPct: e.rtpPct ?? null,
        })),
      },
      ...(parsed.data.initialBalance > 0 && {
        clientWallet: { create: { balance: parsed.data.initialBalance } },
      }),
    },
    include: {
      entitlements: { include: { category: true, game: true } },
      clientWallet: true,
    },
  });

  res.status(201).json({
    client: serializeBigInt(client),
    apiKey,
    warning: "Guarde a API key com segurança. Ela não será exibida novamente.",
  });
});

router.get("/clients", async (_req, res) => {
  const clients = await prisma.client.findMany({
    include: {
      entitlements: { include: { category: true, game: true } },
      clientWallet: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(serializeBigInt(clients));
});

router.get("/clients/:id", async (req, res) => {
  const clientId = req.params.id!;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      entitlements: { include: { category: true, game: true } },
      clientWallet: true,
    },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(serializeBigInt(client));
});

router.put("/clients/:id/entitlements", async (req, res) => {
  const clientId = req.params.id!;
  const entitlements = req.body?.entitlements as Array<{
    categoryId: number;
    gameId?: number | null;
    feePct?: number | null;
    chargePct?: number | null;
    rtpPct?: number | null;
  }>;

  if (!Array.isArray(entitlements)) {
    res.status(400).json({ error: "entitlements array required" });
    return;
  }

  await prisma.clientEntitlement.deleteMany({ where: { clientId } });
  await prisma.clientEntitlement.createMany({
    data: entitlements.map((e) => ({
      clientId,
      categoryId: e.categoryId,
      gameId: e.gameId ?? null,
      feePct: e.feePct ?? null,
      chargePct: e.chargePct ?? null,
      rtpPct: e.rtpPct ?? null,
    })),
  });

  await refreshClientEntitlements(clientId);

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { entitlements: { include: { category: true, game: true } } },
  });

  res.json(serializeBigInt(client));
});

router.get("/clients/:id/wallet", async (req, res) => {
  const { getClientWalletDetails } = await import("../../../services/client-wallet.service.js");
  const details = await getClientWalletDetails(req.params.id!);
  if (!details) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(serializeBigInt(details));
});

router.post("/clients/:id/wallet/fund", async (req, res) => {
  const amount = Number(req.body?.amount);
  const description = req.body?.description ? String(req.body.description) : undefined;
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  const { fundClientWallet } = await import("../../../services/client-wallet.service.js");
  try {
    const result = await fundClientWallet(req.params.id!, amount, description);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Fund failed" });
  }
});

router.post("/clients/:id/wallet/adjust", async (req, res) => {
  const amount = Number(req.body?.amount);
  const description = req.body?.description ? String(req.body.description) : undefined;
  if (!Number.isFinite(amount) || amount === 0) {
    res.status(400).json({ error: "amount must be a non-zero number" });
    return;
  }
  const { adjustClientWallet } = await import("../../../services/client-wallet.service.js");
  try {
    const result = await adjustClientWallet(req.params.id!, amount, description);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Adjust failed" });
  }
});

router.get("/analytics/overview", async (req, res) => {
  const since = req.query.since ? String(req.query.since) : undefined;
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  const { getAnalyticsOverview } = await import("../../../services/admin-analytics.service.js");
  res.json(await getAnalyticsOverview(since, clientId));
});

router.get("/analytics/top-games", async (req, res) => {
  const since = req.query.since ? String(req.query.since) : undefined;
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  const { getTopGames } = await import("../../../services/admin-analytics.service.js");
  res.json(await getTopGames(since, clientId, limit));
});

router.get("/analytics/top-games-by-client", async (req, res) => {
  const since = req.query.since ? String(req.query.since) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const { getTopGamesByClient } = await import("../../../services/admin-analytics.service.js");
  res.json(await getTopGamesByClient(since, limit));
});

router.get("/analytics/client-movement", async (req, res) => {
  const since = req.query.since ? String(req.query.since) : undefined;
  const { getClientMovement } = await import("../../../services/admin-analytics.service.js");
  res.json(await getClientMovement(since));
});

router.get("/analytics/timeseries", async (req, res) => {
  const since = req.query.since ? String(req.query.since) : undefined;
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  const gameId = req.query.gameId ? Number(req.query.gameId) : undefined;
  const { getTimeseries } = await import("../../../services/admin-analytics.service.js");
  res.json(await getTimeseries(since, clientId, gameId));
});

router.get("/analytics/revenue-by-game", async (req, res) => {
  const since = req.query.since ? String(req.query.since) : undefined;
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  const { getRevenueByGame } = await import("../../../services/admin-analytics.service.js");
  res.json(await getRevenueByGame(since, clientId));
});

const createGameSchema = z.object({
  slug: z.string().min(2),
  name: z.string().min(2),
  providerId: z.number().int(),
  categoryId: z.number().int(),
  gameType: z.enum(["SLOT", "CRASH", "TABLE", "BINGO", "INSTANT", "OTHER"]).default("SLOT"),
  engine: z.enum(["CONSTRUCT3", "HTML5", "IFRAME", "NODE", "EXTERNAL"]).default("CONSTRUCT3"),
  assetPath: z.string().nullable().optional(),
  externalUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  rtp: z.number().min(0).max(100).nullable().optional(),
  minBet: z.number().min(0).nullable().optional(),
  maxBet: z.number().min(0).nullable().optional(),
  aggregatorFeePct: z.number().min(0).max(50).default(10),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

router.patch("/clients/:id", async (req, res) => {
  const clientId = req.params.id!;
  const { isActive, marginPct, name, walletUrl, walletSecret, rtpPoolMode, billingMode, maxCredit } =
    req.body as {
      isActive?: boolean;
      marginPct?: number;
      name?: string;
      walletUrl?: string | null;
      walletSecret?: string | null;
      rtpPoolMode?: "GLOBAL" | "PER_CLIENT";
      billingMode?: "PREPAID" | "POSTPAID";
      maxCredit?: number | null;
    };

  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(isActive !== undefined && { isActive }),
      ...(marginPct !== undefined && { marginPct }),
      ...(name !== undefined && { name }),
      ...(walletUrl !== undefined && { walletUrl }),
      ...(walletSecret !== undefined && { walletSecret }),
      ...(rtpPoolMode !== undefined && { rtpPoolMode }),
      ...(billingMode !== undefined && { billingMode }),
      ...(maxCredit !== undefined && { maxCredit }),
    },
  });

  res.json(serializeBigInt(client));
});

router.post("/games", async (req, res) => {
  const parsed = createGameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const game = await prisma.game.create({
    data: parsed.data,
    include: { category: true, provider: true },
  });

  res.status(201).json(serializeBigInt(game));
});

router.get("/games", async (_req, res) => {
  const games = await prisma.game.findMany({
    include: { category: true, provider: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(serializeBigInt(games));
});

router.patch("/games/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }

  const patchSchema = z.object({
    rtp: z.number().min(1).max(99).optional(),
    minBet: z.number().min(0).nullable().optional(),
    maxBet: z.number().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
    name: z.string().min(2).optional(),
    sortOrder: z.number().int().optional(),
    aggregatorFeePct: z.number().min(0).max(50).optional(),
  });

  const parsed = patchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const game = await prisma.game.update({
    where: { id },
    data: parsed.data,
    include: { category: true, provider: true },
  });

  res.json(serializeBigInt(game));
});

router.get("/categories", async (_req, res) => {
  const categories = await prisma.gameCategory.findMany({ orderBy: { sortOrder: "asc" } });
  res.json(serializeBigInt(categories));
});

router.post("/categories", async (req, res) => {
  const { slug, name, sortOrder } = req.body as { slug: string; name: string; sortOrder?: number };
  const category = await prisma.gameCategory.create({
    data: { slug, name, sortOrder: sortOrder ?? 0 },
  });
  res.status(201).json(serializeBigInt(category));
});

router.get("/providers", async (_req, res) => {
  const providers = await prisma.gameProvider.findMany({
    include: { _count: { select: { games: true } } },
    orderBy: { name: "asc" },
  });
  res.json(
    serializeBigInt(
      providers.map((p) => ({
        ...p,
        gameCount: p._count.games,
      })),
    ),
  );
});

router.post("/providers", async (req, res) => {
  const body = req.body as {
    slug: string;
    name: string;
    integration?: "NATIVE" | "SALSA" | "DIRECT";
    defaultCostPct?: number;
    isActive?: boolean;
  };
  const provider = await prisma.gameProvider.create({
    data: {
      slug: body.slug,
      name: body.name,
      integration: body.integration ?? "NATIVE",
      defaultCostPct: body.defaultCostPct ?? null,
      isActive: body.isActive ?? true,
    },
  });
  res.status(201).json(serializeBigInt(provider));
});

router.patch("/providers/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid provider id" });
    return;
  }

  const { isActive, name, defaultCostPct, integration } = req.body as {
    isActive?: boolean;
    name?: string;
    defaultCostPct?: number | null;
    integration?: "NATIVE" | "SALSA" | "DIRECT";
  };

  const cascadeGames = req.query.cascadeGames === "1" || req.query.cascadeGames === "true";

  const provider = await prisma.gameProvider.update({
    where: { id },
    data: {
      ...(isActive !== undefined && { isActive }),
      ...(name !== undefined && { name }),
      ...(defaultCostPct !== undefined && { defaultCostPct }),
      ...(integration !== undefined && { integration }),
    },
  });

  if (isActive !== undefined && cascadeGames) {
    await prisma.game.updateMany({ where: { providerId: id }, data: { isActive } });
  }

  res.json(serializeBigInt(provider));
});

router.post("/providers/:id/toggle-games", async (req, res) => {
  const id = Number(req.params.id);
  const { isActive } = req.body as { isActive: boolean };
  if (Number.isNaN(id) || typeof isActive !== "boolean") {
    res.status(400).json({ error: "provider id and isActive required" });
    return;
  }
  const { setProviderGamesActive } = await import("../../../services/salsa/salsa-sync.service.js");
  const result = await setProviderGamesActive(id, isActive);
  res.json({ ok: true, gamesUpdated: result.count });
});

router.post("/providers/:id/apply-cost", async (req, res) => {
  const id = Number(req.params.id);
  const costPct = Number(req.body?.costPct);
  if (Number.isNaN(id) || !Number.isFinite(costPct)) {
    res.status(400).json({ error: "costPct required" });
    return;
  }
  const { applyProviderCostToGames } = await import("../../../services/salsa/salsa-sync.service.js");
  const result = await applyProviderCostToGames(id, costPct);
  res.json({ ok: true, gamesUpdated: result.count, costPct });
});

router.get("/integrations/salsa/status", async (_req, res) => {
  const { getSalsaIntegrationStatus } = await import("../../../services/salsa/salsa-sync.service.js");
  res.json(await getSalsaIntegrationStatus());
});

router.get("/integrations/salsa/last-request", async (_req, res) => {
  const { getSalsaPublisherTrace } = await import(
    "../../../services/salsa/salsa-publisher.service.js"
  );
  res.json(getSalsaPublisherTrace());
});

router.post("/integrations/salsa/sync", async (req, res) => {
  const { syncSalsaGamesFromSource } = await import("../../../services/salsa/salsa-sync.service.js");
  try {
    const result = await syncSalsaGamesFromSource({
      gameListUrl: req.body?.gameListUrl,
      activateProvider: req.body?.activateProvider,
      defaultCostPct: req.body?.defaultCostPct,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Sync failed" });
  }
});

router.post("/integrations/salsa/publish", async (_req, res) => {
  const { publishExternalCatalogToClients } = await import("../../../services/salsa/salsa-sync.service.js");
  try {
    res.json(await publishExternalCatalogToClients());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Publish failed" });
  }
});

router.get("/integrations/salsa/config", async (_req, res) => {
  const { getSalsaRuntimeConfig } = await import("../../../services/salsa/salsa-config.service.js");
  const { getSalsaIntegrationStatus } = await import("../../../services/salsa/salsa-sync.service.js");
  const [config, status] = await Promise.all([getSalsaRuntimeConfig(), getSalsaIntegrationStatus()]);
  res.json({
    ...config,
    hasHashKey: Boolean(config.hashKey),
    hashKey: undefined,
    publisherUrl: status.publisherUrl,
    gamesImported: status.gamesImported,
    providerActive: status.providerActive,
  });
});

router.put("/integrations/salsa/config", async (req, res) => {
  const { upsertSalsaConfig } = await import("../../../services/salsa/salsa-config.service.js");
  const body = req.body as {
    enabled?: boolean;
    publisherName?: string | null;
    hashKey?: string | null;
    gameListUrl?: string | null;
    apiBase?: string;
    defaultProviderCostPct?: number;
  };

  const row = await upsertSalsaConfig(body);
  res.json(serializeBigInt(row));
});

router.get("/integrations/salsa/games", async (req, res) => {
  const { listSalsaGames } = await import("../../../services/salsa/salsa-sync.service.js");
  const providerId = req.query.providerId ? Number(req.query.providerId) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;
  const activeOnly = req.query.activeOnly === "1" || req.query.activeOnly === "true";
  res.json(await listSalsaGames({ providerId, search, activeOnly }));
});

router.post("/integrations/salsa/fees/provider-cost", async (req, res) => {
  const { bulkSetProviderCost } = await import("../../../services/salsa/salsa-sync.service.js");
  const providerCostPct = Number(req.body?.providerCostPct);
  if (!Number.isFinite(providerCostPct)) {
    res.status(400).json({ error: "providerCostPct required" });
    return;
  }
  try {
    const result = await bulkSetProviderCost({
      providerCostPct,
      providerId: req.body?.providerId ? Number(req.body.providerId) : undefined,
      gameIds: Array.isArray(req.body?.gameIds) ? req.body.gameIds.map(Number) : undefined,
      integration: req.body?.integration,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Update failed" });
  }
});

router.patch("/games/:id/fees", async (req, res) => {
  const id = Number(req.params.id);
  const providerCostPct = Number(req.body?.providerCostPct ?? req.body?.aggregatorFeePct);
  if (Number.isNaN(id) || !Number.isFinite(providerCostPct)) {
    res.status(400).json({ error: "providerCostPct required" });
    return;
  }
  const { setGameProviderCost } = await import("../../../services/salsa/salsa-sync.service.js");
  const game = await setGameProviderCost(id, providerCostPct);
  res.json(serializeBigInt(game));
});

router.get("/clients/:id/game-fees", async (req, res) => {
  const clientId = req.params.id!;
  const integration = req.query.integration ? String(req.query.integration) : undefined;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, marginPct: true, entitlements: true },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const games = await prisma.game.findMany({
    where: {
      isActive: true,
      ...(integration && { provider: { integration: integration as "SALSA" | "DIRECT" | "NATIVE" } }),
    },
    include: { provider: { select: { slug: true, name: true, integration: true } } },
    orderBy: { name: "asc" },
  });

  const rows = games.map((g) => {
    const ent =
      client.entitlements.find((e) => e.gameId === g.id && e.isEnabled) ??
      client.entitlements.find((e) => e.gameId === null && e.categoryId === g.categoryId && e.isEnabled);

    const providerCostPct =
      ent?.feePct !== null && ent?.feePct !== undefined ? Number(ent.feePct) : Number(g.aggregatorFeePct);
    const chargePct =
      ent?.chargePct !== null && ent?.chargePct !== undefined
        ? Number(ent.chargePct)
        : Number(providerCostPct) + Number(client.marginPct);

    return {
      gameId: g.id,
      slug: g.slug,
      name: g.name,
      provider: g.provider,
      providerCostPct,
      chargePct,
      yourMarginPct: Math.max(0, chargePct - providerCostPct),
      entitlement: ent
        ? {
            id: ent.id,
            feePct: ent.feePct ? Number(ent.feePct) : null,
            chargePct: ent.chargePct ? Number(ent.chargePct) : null,
          }
        : null,
    };
  });

  res.json({ client: { id: client.id, name: client.name, marginPct: Number(client.marginPct) }, games: rows });
});

router.put("/clients/:id/game-fees", async (req, res) => {
  const clientId = req.params.id!;
  const items = req.body?.items as Array<{
    gameId: number;
    chargePct?: number | null;
    providerCostPct?: number | null;
    rtpPct?: number | null;
  }>;

  if (!Array.isArray(items) || !items.length) {
    res.status(400).json({ error: "items array required" });
    return;
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  for (const item of items) {
    const game = await prisma.game.findUnique({ where: { id: item.gameId } });
    if (!game) continue;

    const existing = await prisma.clientEntitlement.findFirst({
      where: { clientId, gameId: item.gameId },
    });

    const data = {
      categoryId: game.categoryId,
      isEnabled: true,
      feePct: item.providerCostPct ?? existing?.feePct ?? null,
      chargePct: item.chargePct ?? existing?.chargePct ?? null,
      rtpPct: item.rtpPct ?? existing?.rtpPct ?? null,
    };

    if (existing) {
      await prisma.clientEntitlement.update({ where: { id: existing.id }, data });
    } else {
      await prisma.clientEntitlement.create({
        data: { clientId, gameId: item.gameId, ...data },
      });
    }
  }

  await refreshClientEntitlements(clientId);
  res.json({ ok: true, updated: items.length });
});

router.get("/rtp/dashboard", async (_req, res) => {
  const { getRtpDashboard } = await import("../../../services/rtp-report.service.js");
  const report = await getRtpDashboard();
  res.json(report);
});

router.get("/fees/report", async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  const gameId = req.query.gameId ? Number(req.query.gameId) : undefined;

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: { gte: since },
      ...(clientId && { session: { clientId } }),
      ...(gameId && { session: { gameId } }),
    },
    include: {
      session: {
        select: {
          clientId: true,
          gameId: true,
          externalUserId: true,
          client: { select: { name: true } },
          game: { select: { slug: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const totals = spins.reduce(
    (acc, spin) => {
      acc.betAmount += Number(spin.betAmount);
      acc.winAmount += Number(spin.winAmount);
      acc.gameFeeAmount += Number(spin.gameFeeAmount);
      acc.clientFeeAmount += Number(spin.clientFeeAmount);
      acc.spinCount += 1;
      return acc;
    },
    { betAmount: 0, winAmount: 0, gameFeeAmount: 0, clientFeeAmount: 0, spinCount: 0 },
  );

  res.json({
    since: since.toISOString(),
    totals: {
      ...totals,
      totalFeeAmount: totals.gameFeeAmount + totals.clientFeeAmount,
      ggr: totals.betAmount - totals.winAmount,
    },
    spins: serializeBigInt(spins),
  });
});

router.get("/games/:id/rtp", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  let rtpPoolMode: "GLOBAL" | "PER_CLIENT" = "GLOBAL";

  if (clientId) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, rtpPoolMode: true },
    });
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    rtpPoolMode = client.rtpPoolMode;
  }

  const { getRtpStats } = await import("../../../services/rtp-pool.service.js");
  const targetRtpPct = targetRtpFromGame(game.rtp);
  const stats = await getRtpStats({
    gameId: id,
    targetRtpPct,
    clientId,
    rtpPoolMode,
  });

  res.json({
    game: { id: game.id, slug: game.slug, name: game.name, targetRtpPct },
    ...stats,
    houseEdgePct: 100 - targetRtpPct,
  });
});

router.get("/clients/:id/rtp", async (req, res) => {
  const clientId = req.params.id!;
  const gameId = req.query.gameId ? Number(req.query.gameId) : undefined;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, rtpPoolMode: true },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const { getRtpStats } = await import("../../../services/rtp-pool.service.js");

  if (gameId && !Number.isNaN(gameId)) {
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }

    const targetRtpPct = targetRtpFromGame(game.rtp);
    const stats = await getRtpStats({
      gameId,
      targetRtpPct,
      clientId,
      rtpPoolMode: client.rtpPoolMode,
    });

    res.json({
      client,
      game: { id: game.id, slug: game.slug, name: game.name, targetRtpPct },
      ...stats,
      houseEdgePct: 100 - targetRtpPct,
    });
    return;
  }

  const ledgers =
    client.rtpPoolMode === "PER_CLIENT"
      ? await prisma.clientGameRtpLedger.findMany({
          where: { clientId },
          include: { game: { select: { id: true, slug: true, name: true, rtp: true } } },
          orderBy: { totalWagered: "desc" },
        })
      : [];

  const globalGames = await prisma.gameRtpLedger.findMany({
    include: { game: { select: { id: true, slug: true, name: true, rtp: true } } },
    orderBy: { totalWagered: "desc" },
  });

  res.json({
    client,
    mode: client.rtpPoolMode,
    perClientLedgers: ledgers.map((l) => ({
      game: l.game,
      totalWagered: Number(l.totalWagered),
      totalPaidOut: Number(l.totalPaidOut),
      housePool: Number(l.housePool),
      actualRtpPct:
        Number(l.totalWagered) > 0
          ? Math.round((Number(l.totalPaidOut) / Number(l.totalWagered)) * 10000) / 100
          : 0,
    })),
    globalLedgers:
      client.rtpPoolMode === "GLOBAL"
        ? globalGames.map((l) => ({
            game: l.game,
            totalWagered: Number(l.totalWagered),
            totalPaidOut: Number(l.totalPaidOut),
            housePool: Number(l.housePool),
            actualRtpPct:
              Number(l.totalWagered) > 0
                ? Math.round((Number(l.totalPaidOut) / Number(l.totalWagered)) * 10000) / 100
                : 0,
          }))
        : [],
  });
});

export default router;
