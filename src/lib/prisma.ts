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

/** Garante colunas/tabelas novas sem exigir prisma db push no servidor. */
export function ensureSchemaPatches() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const statements = [
        `ALTER TABLE game_providers ADD COLUMN IF NOT EXISTS display_name TEXT`,
        `ALTER TABLE clients ADD COLUMN IF NOT EXISTS charge_pct DECIMAL(5,2)`,
        `ALTER TABLE salsa_integration_config ADD COLUMN IF NOT EXISTS default_operator_charge_pct DECIMAL(5,2) DEFAULT 20`,
        `CREATE TABLE IF NOT EXISTS client_provider_access (
          id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          provider_id INTEGER NOT NULL REFERENCES game_providers(id) ON DELETE CASCADE,
          is_enabled BOOLEAN NOT NULL DEFAULT false,
          fee_pct DECIMAL(5,2),
          charge_pct DECIMAL(5,2),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS client_provider_access_client_id_provider_id_key ON client_provider_access(client_id, provider_id)`,
      ];
      for (const sql of statements) {
        try {
          await prisma.$executeRawUnsafe(sql);
        } catch {
          /* coluna/tabela já existe ou o patch não se aplica */
        }
      }
    })();
  }
  return schemaReady;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
