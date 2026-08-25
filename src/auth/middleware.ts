import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, authenticateApiKey, isAdminRequest } from "./auth.service.js";
import type { JwtPayload } from "../types/index.js";

export interface AuthenticatedRequest extends Request {
  client?: {
    id: string;
    name: string;
    marginPct: number;
  };
  jwt?: JwtPayload;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    req.jwt = payload;
    req.client = {
      id: payload.clientId,
      name: payload.clientName,
      marginPct: 0,
    };
    next();
    return;
  }

  if (apiKey) {
    const client = await authenticateApiKey(apiKey);
    if (!client) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    req.client = {
      id: client.id,
      name: client.name,
      marginPct: Number(client.marginPct),
    };
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey = req.headers["x-admin-key"] as string | undefined;

  if (!isAdminRequest(apiKey)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export async function sessionMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionToken =
    (req.headers["x-session-token"] as string | undefined) ??
    (req.query.sessionToken as string | undefined);

  if (!sessionToken) {
    res.status(401).json({ error: "Session token required" });
    return;
  }

  const { prisma } = await import("../lib/prisma.js");
  const session = await prisma.gameSession.findUnique({
    where: { sessionToken },
    include: { game: true, client: true },
  });

  if (!session || !session.isActive || session.expiresAt < new Date()) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  (req as AuthenticatedRequest & { gameSession: typeof session }).gameSession = session;
  next();
}