import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3010),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6380"),

  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  ADMIN_API_KEY: z.string().min(8),

  GAMES_DIR: z.string().default("./games"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3010"),

  /** Integração Salsa — deixe vazio até receber credenciais */
  SALSA_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  /** PN Salsa de teste (staging). */
  SALSA_PN: z.string().optional(),
  SALSA_HASH_KEY: z.string().optional(),
  SALSA_GAME_LIST_URL: z.string().optional(),
  /** PN / hash / catálogo Salsa de produção. Cada cassino escolhe TEST ou LIVE no admin. */
  SALSA_PN_LIVE: z.string().optional(),
  SALSA_HASH_KEY_LIVE: z.string().optional(),
  SALSA_GAME_LIST_URL_LIVE: z.string().optional(),
  SALSA_API_BASE: z.string().default("https://api-test.salsagator.com"),
  /** CHARGED = dinheiro real. Staging da Salsa costuma ter CHARGED desligado — use FREE. */
  SALSA_LAUNCH_TYPE: z.enum(["CHARGED", "FREE", "omit"]).optional(),
  /** Quantos IDs `provider=N` varrer. PG Soft ~42, Pragmatic e outros vêm depois de buracos 400. */
  SALSA_PROVIDER_SCAN_MAX: z.coerce.number().int().min(1).max(500).default(250),
  /** Doc Salsa: gameLogo default false. true inclui gameLogoUrl (CMS) e/ou BASE64. */
  SALSA_GAME_LOGO: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v !== "false"),
  /** URL pública que a Salsa chama (túnel/produção). Sem isso, localhost gera Communication error. */
  SALSA_PUBLISHER_URL: z.string().optional(),
  SALSA_DEFAULT_COST_PCT: z.coerce.number().default(6.5),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const REDIS_CHANNELS = {
  GAME_UPDATES: "casino:game_updates",
} as const;
