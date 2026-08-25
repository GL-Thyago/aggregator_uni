import { Router, type Request, type Response } from "express";
import { handleGameBridge } from "../../../services/game-bridge.service.js";
import { getSessionByToken } from "../../../services/session.service.js";

const router = Router();

const ENDPOINTS = new Set(["session", "icons", "spin", "buy", "logs", "save", "bet", "cashout", "crash", "play", "status", "start_flight", "start", "reveal"]);

function extractSessionToken(req: Request): string | null {
  const fromParams = req.params.sessionToken;
  if (typeof fromParams === "string" && fromParams) return fromParams;

  const fromQuery = req.query.sessionToken;
  if (typeof fromQuery === "string" && fromQuery) return fromQuery;

  const body = req.body as Record<string, unknown> | undefined;
  // simple-php envia o token em body.id; o header X-Ncash-token é outro UUID do plugin
  if (body && typeof body.id === "string" && body.id) {
    return body.id;
  }
  if (body && typeof body.sessionToken === "string" && body.sessionToken) {
    return body.sessionToken;
  }

  const fromHeader = req.headers["x-session-token"] ?? req.headers["x-ncash-token"];
  if (typeof fromHeader === "string" && fromHeader) return fromHeader;

  const referer = req.headers.referer ?? req.headers.referrer;
  if (typeof referer === "string") {
    try {
      const token = new URL(referer).searchParams.get("sessionToken");
      if (token) return token;
    } catch {
      /* ignore */
    }
  }

  return null;
}

function buildBridgeBody(req: Request, endpointFromPath?: string): Record<string, unknown> {
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? { ...(req.body as Record<string, unknown>) }
      : {};

  const action = String(body.action ?? endpointFromPath ?? "");
  if (action) body.action = action;

  return body;
}

export async function handlePlayRequest(req: Request, res: Response, endpointFromPath?: string) {
  if (endpointFromPath && !ENDPOINTS.has(endpointFromPath)) {
    res.status(404).json({ success: false, message: "Unknown endpoint" });
    return;
  }

  const sessionToken = extractSessionToken(req);
  if (!sessionToken) {
    res.status(200).json({ success: false, message: "sessionToken required" });
    return;
  }

  try {
    const result = (await handleGameBridge(sessionToken, buildBridgeBody(req, endpointFromPath))) as {
      success: boolean;
      message?: string;
    };
    if (!result.success) {
      // Construct3 simple-php (npost) só processa HTTP 200 — erros vão no JSON.
      res.status(200).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    res.status(200).json({
      success: false,
      message: err instanceof Error ? err.message : "Erro interno no jogo",
    });
  }
}

/** Construct3 path-style: GET/POST /api/v1/game/:sessionToken/session|icons|spin */
router.get("/game/:sessionToken/:endpoint", (req, res) =>
  handlePlayRequest(req, res, String(req.params.endpoint)),
);

router.post("/game/:sessionToken/:endpoint", (req, res) =>
  handlePlayRequest(req, res, String(req.params.endpoint)),
);

/** Construct3 simple-php style: POST /api/v1/game { action, game, id: sessionToken } */
router.post("/game", (req, res) => handlePlayRequest(req, res));

/** Alias quando o token vem na URL */
router.post("/game/:sessionToken", (req, res) => handlePlayRequest(req, res));

/** Alias legado — preferir /game/:sessionToken/:endpoint */
router.post("/game-bridge/:sessionToken", (req, res) => handlePlayRequest(req, res));

router.get("/game-bridge/:sessionToken", async (req, res) => {
  const session = await getSessionByToken(String(req.params.sessionToken));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ ok: true, gameSlug: session.game.slug, expiresAt: session.expiresAt });
});

export default router;
