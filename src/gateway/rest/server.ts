import express from "express";
import type { Server } from "node:http";
import path from "node:path";
import cors from "cors";
import { env } from "../../config/env.js";
import { resolveGamesDir } from "../../services/game.service.js";
import apiRoutes from "./routes/api.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import metaRoutes from "./routes/meta.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import gamePlayRoutes, { handlePlayRequest } from "./routes/game-play.routes.js";
import salsaRoutes from "./routes/salsa.routes.js";

export function createRestServer(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/admin-panel", express.static(path.join(process.cwd(), "admin"), { index: "index.html" }));
  app.use("/aggregator-adm", express.static(path.join(process.cwd(), "aggregator_adm"), { index: "index.html" }));

  /** Compat: jogos Construct3 simple-php ainda chamam POST .../api/index.php (cache SW antigo) */
  app.post("/games/:slug/api/index.php", (req, res, next) => {
    handlePlayRequest(req, res).catch(next);
  });

  const gamesDir = resolveGamesDir();
  app.use(
    "/games",
    express.static(gamesDir, {
      index: ["index.html"],
      setHeaders(res, filePath) {
        if (/\.(png|jpg|jpeg|webp|svg|gif)$/i.test(filePath)) {
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          res.setHeader("Access-Control-Allow-Origin", "*");
        }
        if (
          filePath.endsWith("data.json") ||
          filePath.endsWith("offline.json") ||
          filePath.endsWith("index.html") ||
          filePath.endsWith("register-sw.js")
        ) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );

  app.use("/api/v1", metaRoutes);
  app.use("/api/v1", salsaRoutes);
  app.use("/api/v1", apiRoutes);
  app.use("/api/v1", walletRoutes);
  app.use("/api/v1", gamePlayRoutes);
  app.use("/admin/v1", adminRoutes);

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("[REST] Unhandled error:", err);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}

let httpServer: Server | null = null;

export function startRestServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }

  const app = createRestServer();
  httpServer = app.listen(env.PORT, () => {
    console.log(`[REST] Casino Aggregator running on http://localhost:${env.PORT}`);
    console.log(`[REST] API:  http://localhost:${env.PORT}/api/v1`);
    console.log(`[REST] Admin API: http://localhost:${env.PORT}/admin/v1`);
    console.log(`[REST] Admin UI:  http://localhost:${env.PORT}/admin-panel/`);
    console.log(`[REST] Aggregator ADM: http://localhost:${env.PORT}/aggregator-adm/`);
    console.log(`[REST] Salsa Publisher: http://localhost:${env.PORT}/api/v1/salsa/publisher`);
    console.log(`[REST] Games: http://localhost:${env.PORT}/games/ (dir: ${path.resolve(env.GAMES_DIR)})`);
    void import("../../services/salsa/salsa-sync.service.js")
      .then((m) => m.hideNonSalsaCatalog())
      .catch((err: unknown) => console.error("[REST] hideNonSalsaCatalog failed", err));
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[REST] Port ${env.PORT} already in use. Change PORT in .env`);
      process.exit(1);
    }
    console.error("[REST] Server error:", err);
  });
}

export async function stopRestServer(): Promise<void> {
  if (!httpServer) return;

  await new Promise<void>((resolve) => {
    httpServer!.close(() => resolve());
  });
  httpServer = null;
}
