import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ensureSchemaPatches, prisma } from "../lib/prisma.js";

const TOKEN_AUDIENCE = "provider-portal";

export async function setProviderPortalPassword(password: string) {
  await ensureSchemaPatches();
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, salt, 64);
  const passwordHash = `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
  return prisma.providerPortalConfig.upsert({
    where: { id: 1 },
    create: { id: 1, passwordHash },
    update: { passwordHash },
    select: { updatedAt: true },
  });
}

export async function isProviderPortalConfigured() {
  await ensureSchemaPatches();
  return Boolean(await prisma.providerPortalConfig.findUnique({ where: { id: 1 }, select: { id: true } }));
}

export async function authenticateProviderPortal(password: string): Promise<string | null> {
  await ensureSchemaPatches();
  const config = await prisma.providerPortalConfig.findUnique({ where: { id: 1 } });
  if (!config) return null;
  const [, saltHex, expectedHex] = config.passwordHash.split("$");
  if (!saltHex || !expectedHex) return null;

  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  return jwt.sign({ role: "provider-portal" }, env.JWT_SECRET, {
    audience: TOKEN_AUDIENCE,
    expiresIn: "8h",
  });
}

export function verifyProviderPortalToken(token: string): boolean {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { audience: TOKEN_AUDIENCE });
    return typeof payload === "object" && payload.role === "provider-portal";
  } catch {
    return false;
  }
}
