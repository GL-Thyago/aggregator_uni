import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { hashApiKey } from "../lib/utils.js";
import type { JwtPayload } from "../types/index.js";
import { loadClientEntitlements } from "../entitlements/entitlement.service.js";

export async function authenticateApiKey(apiKey: string) {
  const apiKeyHash = hashApiKey(apiKey);
  const client = await prisma.client.findUnique({
    where: { apiKeyHash },
    select: { id: true, name: true, isActive: true, marginPct: true },
  });

  if (!client || !client.isActive) return null;
  return client;
}

export function signAccessToken(client: { id: string; name: string }): string {
  const payload: JwtPayload = {
    sub: client.id,
    clientId: client.id,
    clientName: client.name,
    type: "access",
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export async function createRefreshToken(clientId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashApiKey(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { clientId, tokenHash, expiresAt },
  });

  return token;
}

export async function refreshAccessToken(refreshToken: string) {
  const tokenHash = hashApiKey(refreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { client: { select: { id: true, name: true, isActive: true } } },
  });

  if (!stored || stored.revoked || stored.expiresAt < new Date() || !stored.client.isActive) {
    return null;
  }

  const accessToken = signAccessToken(stored.client);
  return { accessToken, client: stored.client };
}

export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (payload.type !== "access") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashApiKey(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { revoked: true },
  });
}

export async function loginWithApiKey(apiKey: string) {
  const client = await authenticateApiKey(apiKey);
  if (!client) return null;

  const accessToken = signAccessToken(client);
  const refreshToken = await createRefreshToken(client.id);
  await loadClientEntitlements(client.id);

  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    client: { id: client.id, name: client.name },
  };
}

export function isAdminRequest(apiKey: string | undefined): boolean {
  return apiKey === env.ADMIN_API_KEY;
}
