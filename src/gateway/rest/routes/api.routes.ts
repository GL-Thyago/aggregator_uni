import { Router } from "express";
import { z } from "zod";
import {
  loginWithApiKey,
  refreshAccessToken,
  revokeRefreshToken,
} from "../../../auth/auth.service.js";
import {
  getAllowedGameIds,
  getEntitledGamesTree,
  isGameEntitled,
  loadClientEntitlements,
} from "../../../entitlements/entitlement.service.js";
import { authMiddleware, sessionMiddleware, type AuthenticatedRequest } from "../../../auth/middleware.js";
import { serializeBigInt } from "../../../lib/utils.js";
import {
  getGameBySlug,
  listGamesForClient,
  syncGamesForClient,
  toClientGameDto,
} from "../../../services/game.service.js";
import { createGameSession, getSessionBalance, processSpin } from "../../../services/session.service.js";
import { prisma } from "../../../lib/prisma.js";

const router = Router();

const loginSchema = z.object({
  apiKey: z.string().min(10),
});

router.post("/auth/token", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const result = await loginWithApiKey(parsed.data.apiKey);
  if (!result) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  res.json(result);
});

router.post("/auth/refresh", async (req, res) => {
  const refreshToken = req.body?.refreshToken as string | undefined;
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken required" });
    return;
  }

  const result = await refreshAccessToken(refreshToken);
  if (!result) {
    res.status(401).json({ error: "Invalid refresh token" });
    return;
  }

  res.json({ accessToken: result.accessToken, expiresIn: "15m" });
});

router.post("/auth/logout", async (req, res) => {
  const refreshToken = req.body?.refreshToken as string | undefined;
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  res.json({ ok: true });
});

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "casino_aggregator", ts: Date.now() });
});

router.get("/media/cover/:slug", async (req, res) => {
  const { getGameCoverPayload } = await import("../../../services/game-cover.service.js");
  const payload = await getGameCoverPayload(decodeURIComponent(String(req.params.slug)));
  if (!payload) {
    res.status(404).end();
    return;
  }
  if ("buffer" in payload && payload.buffer) {
    res.set("Content-Type", payload.contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Access-Control-Allow-Origin", "*");
    res.send(payload.buffer);
    return;
  }
  if ("redirect" in payload && payload.redirect) {
    res.redirect(302, payload.redirect);
    return;
  }
  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.set("Access-Control-Allow-Origin", "*");
  res.send("svg" in payload ? payload.svg : "");
});

router.get("/categories", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const tree = await getEntitledGamesTree(req.client!.id);
  res.json(serializeBigInt(tree));
});

router.get("/games", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const allowedGameIds = await getAllowedGameIds(req.client!.id);
  let games = await listGamesForClient(req.client!.id, allowedGameIds);

  if (req.query.featured === "1") {
    games = games.filter((g) => g.isFeatured);
  }

  res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
  res.json(serializeBigInt(games.map((g) => toClientGameDto(g))));
});

router.get("/games/:slug", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const slug = decodeURIComponent(String(req.params.slug));
  const game = await getGameBySlug(slug);
  if (!game || !game.isActive || !game.provider.isActive) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const entitlements = await loadClientEntitlements(req.client!.id);
  if (!isGameEntitled(entitlements, game.categoryId, game.id)) {
    res.status(403).json({ error: "Game not entitled for this client" });
    return;
  }

  res.json(serializeBigInt(toClientGameDto(game)));
});

router.get("/sync/games", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const result = await syncGamesForClient(req.client!.id);
  res.json(result);
});

const launchSchema = z.object({
  externalUserId: z.string().min(1),
  currency: z.string().default("BRL"),
  environment: z.enum(["test", "live"]).optional(),
});

router.post("/games/:slug/launch", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const parsed = launchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const slug = decodeURIComponent(String(req.params.slug));
  const game = await getGameBySlug(slug);
  if (!game || !game.isActive || !game.provider.isActive) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const entitlements = await loadClientEntitlements(req.client!.id);
  if (!isGameEntitled(entitlements, game.categoryId, game.id)) {
    res.status(403).json({ error: "Game not entitled for this client" });
    return;
  }

  try {
    const launch = await createGameSession({
      clientId: req.client!.id,
      gameId: game.id,
      externalUserId: parsed.data.externalUserId,
      currency: parsed.data.currency,
      environment: parsed.data.environment,
    });
    res.json(launch);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Launch failed" });
  }
});

router.get("/session/balance", sessionMiddleware, async (req, res) => {
  const sessionToken = req.headers["x-session-token"] as string;
  const balance = await getSessionBalance(sessionToken);
  if (!balance) {
    res.status(401).json({ error: "Invalid session" });
    return;
  }
  res.json(balance);
});

const spinSchema = z.object({
  betAmount: z.number().positive(),
});

router.post("/session/spin", sessionMiddleware, async (req, res) => {
  const parsed = spinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const session = (req as AuthenticatedRequest & { gameSession: { sessionToken: string } }).gameSession;

  try {
    const result = await processSpin({
      sessionToken: session.sessionToken,
      betAmount: parsed.data.betAmount,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Spin failed" });
  }
});

router.get("/catalog/providers", authMiddleware, async (_req, res) => {
  const providers = await prisma.gameProvider.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  res.json(serializeBigInt(providers));
});

router.get("/catalog/categories", authMiddleware, async (_req, res) => {
  const categories = await prisma.gameCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  res.json(serializeBigInt(categories));
});

export default router;
