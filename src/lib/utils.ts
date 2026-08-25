import crypto from "node:crypto";

export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val) =>
      typeof val === "bigint" ? val.toString() : val,
    ),
  ) as T;
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function generateApiKey(): string {
  return `ca_${crypto.randomBytes(32).toString("hex")}`;
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function decimalToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}
