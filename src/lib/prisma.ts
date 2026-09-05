import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const max = Number(process.env.DB_POOL_MAX ?? 20);
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

let schemaReady: Promise<void> | null = null;

/** Garante colunas novas sem exigir prisma db push no servidor. */
export function ensureSchemaPatches() {
  if (!schemaReady) {
    schemaReady = prisma
      .$executeRawUnsafe(`ALTER TABLE game_providers ADD COLUMN IF NOT EXISTS display_name TEXT`)
      .then(() => undefined)
      .catch(() => undefined);
  }
  return schemaReady;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
