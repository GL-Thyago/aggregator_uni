import crypto from "node:crypto";
import { env } from "./env.js";

export function isSalsaConfigured(): boolean {
  return Boolean(env.SALSA_PN && env.SALSA_HASH_KEY);
}

export function isLocalHostname(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return true;
  }
}

export function salsaPublisherUrl(): string {
  const explicit = env.SALSA_PUBLISHER_URL?.replace(/\/$/, "");
  if (explicit) {
    return explicit.endsWith("/publisher") ? explicit : `${explicit}/api/v1/salsa/publisher`;
  }
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/v1/salsa/publisher`;
}

export function buildSalsaLaunchUrl(input: {
  token: string;
  gameCode: string;
  lang?: string;
  currency?: string;
  type?: "CHARGED" | "FREE";
}): string {
  const pn = env.SALSA_PN;
  if (!pn) {
    throw new Error("SALSA_PN não configurado — adicione no .env quando receber da Salsa");
  }

  const base = env.SALSA_API_BASE.replace(/\/$/, "");
  const url = new URL(`${base}/game`);
  url.searchParams.set("token", input.token);
  url.searchParams.set("pn", pn);
  url.searchParams.set("lang", input.lang ?? "pt");
  url.searchParams.set("game", input.gameCode);
  url.searchParams.set("type", input.type ?? "CHARGED");
  if (input.currency) url.searchParams.set("currency", input.currency);
  return url.toString();
}

export function salsaHash(paramsValue: string, hashKey = env.SALSA_HASH_KEY ?? ""): string {
  return crypto.createHash("sha256").update(paramsValue + hashKey).digest("hex");
}

export function validateSalsaHash(paramsValue: string, hash: string, hashKey?: string): boolean {
  const key = hashKey ?? env.SALSA_HASH_KEY;
  if (!key || !hash) return false;
  const expected = salsaHash(paramsValue, key);
  return expected.toLowerCase() === hash.toLowerCase();
}

export function extTransactionNum(seed: string): bigint {
  const buf = crypto.createHash("sha256").update(seed).digest();
  const n = buf.readBigUInt64BE(0) % 8_000_000_000_000n;
  return 1_000_000_000_000n + n;
}

export function centsToMoney(cents: number): number {
  return Math.round(cents) / 100;
}

export function moneyToCents(amount: number): number {
  return Math.round(amount * 100);
}
