import "dotenv/config";
import { connectRedis, disconnectRedis } from "./lib/redis.js";
import { disconnectPrisma } from "./lib/prisma.js";
import { startRestServer, stopRestServer } from "./gateway/rest/server.js";

async function main(): Promise<void> {
  await connectRedis();
  startRestServer();
  console.log("[App] Casino aggregator started");
}

async function shutdown(): Promise<void> {
  console.log("[App] Shutting down...");
  await stopRestServer();
  await disconnectRedis();
  await disconnectPrisma();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void main().catch((err: unknown) => {
  console.error("[App] Fatal error:", err);
  process.exit(1);
});
