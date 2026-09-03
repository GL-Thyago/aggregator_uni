import { Router } from "express";
import { z } from "zod";
import { authMiddleware, type AuthenticatedRequest } from "../../../auth/middleware.js";
import {
  UNI_BRAND,
  uniEnvironmentDescriptor,
  uniGpiUrl,
  uniPn,
  uniPublicBase,
  type UniEnvironment,
} from "../../../config/uni.js";
import {
  canClientAccessGame,
  getAllowedGameIds,
} from "../../../entitlements/entitlement.service.js";
import { serializeBigInt } from "../../../lib/utils.js";
import { getGameBySlug } from "../../../services/game.service.js";
import { createGameSession } from "../../../services/session.service.js";

const router = Router();

const launchSchema = z.object({
  externalUserId: z.string().min(1),
  currency: z.string().default("BRL"),
});

function environmentPayload(environment: UniEnvironment) {
  return uniEnvironmentDescriptor(environment);
}

async function launchInEnvironment(
  req: AuthenticatedRequest,
  res: import("express").Response,
  environment: UniEnvironment,
) {
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

  if (!(await canClientAccessGame(req.client!.id, game))) {
    res.status(403).json({ error: "Game not entitled for this client" });
    return;
  }

  try {
    const launch = await createGameSession({
      clientId: req.client!.id,
      gameId: game.id,
      externalUserId: parsed.data.externalUserId,
      currency: parsed.data.currency,
      environment,
    });

    const pn = uniPn(environment);
    const gpiUrl =
      environment === "test" && pn ? uniGpiUrl(launch.sessionToken, pn) : undefined;

    res.json({
      environment,
      ...launch,
      ...(gpiUrl ? { gpiUrl } : {}),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Launch failed" });
  }
}

function registerLaunchRoutes(prefix: string) {
  router.get(`${prefix}`, (_req, res) => {
    const base = uniPublicBase();
    res.json({
      brand: UNI_BRAND.name,
      docs: `${base}${UNI_BRAND.docsPath}`,
      api: `${base}/api/v1`,
      environments: {
        test: `${base}/api/v1/uni/test`,
        live: `${base}/api/v1/uni/live`,
      },
      test: environmentPayload("test"),
      live: environmentPayload("live"),
    });
  });

  router.get(`${prefix}/test`, (_req, res) => {
    res.json(environmentPayload("test"));
  });

  router.get(`${prefix}/live`, (_req, res) => {
    res.json(environmentPayload("live"));
  });

  router.get(`${prefix}/test/games`, authMiddleware, async (req: AuthenticatedRequest, res) => {
    const { listGamesForClient, toClientGameDto } = await import("../../../services/game.service.js");
    const allowedGameIds = await getAllowedGameIds(req.client!.id);
    const games = await listGamesForClient(req.client!.id, allowedGameIds);
    res.json(serializeBigInt(games.map((g) => toClientGameDto(g))));
  });

  router.post(`${prefix}/test/games/:slug/launch`, authMiddleware, async (req: AuthenticatedRequest, res) => {
    await launchInEnvironment(req, res, "test");
  });

  router.post(`${prefix}/live/games/:slug/launch`, authMiddleware, async (req: AuthenticatedRequest, res) => {
    await launchInEnvironment(req, res, "live");
  });
}

registerLaunchRoutes("/uni");
registerLaunchRoutes("/unime");

export default router;
