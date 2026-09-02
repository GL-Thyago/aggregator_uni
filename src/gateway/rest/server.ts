import express from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { env } from "../../config/env.js";
import { resolveGamesDir } from "../../services/game.service.js";
import apiRoutes from "./routes/api.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import metaRoutes from "./routes/meta.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import gamePlayRoutes, { handlePlayRequest } from "./routes/game-play.routes.js";
import salsaRoutes from "./routes/salsa.routes.js";
import uniRoutes from "./routes/uni.routes.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function sendIndex(dirName: string, res: express.Response) {
  const index = path.join(repoRoot, dirName, "index.html");
  if (!fs.existsSync(index)) {
    res.status(404).type("text/plain").send(`Não achei ${dirName}/index.html em ${repoRoot}`);
    return;
  }
  res.sendFile(index);
}

export function createRestServer(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const docsUni = path.join(repoRoot, "docs", "uni");
  app.get("/docs/uni/download/:file", (req, res) => {
    const allowed: Record<string, { disk: string; name: string }> = {
      "interno.md": { disk: "interno.md", name: "uni-guia-interno.md" },
      "cliente.md": { disk: "cliente.md", name: "uni-guia-cliente.md" },
      "interno.html": { disk: "interno.html", name: "uni-guia-interno.html" },
      "cliente.html": { disk: "cliente.html", name: "uni-guia-cliente.html" },
    };
    const entry = allowed[String(req.params.file)];
    if (!entry) {
      res.status(404).json({ error: "Arquivo não encontrado" });
      return;
    }
    res.download(path.join(docsUni, entry.disk), entry.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "Arquivo não encontrado" });
    });
  });
  app.use("/docs/uni", express.static(docsUni, { index: "index.html" }));
  app.use("/docs/unime", express.static(docsUni, { index: "index.html" }));
  app.get(["/uni", "/unime", "/docs"], (_req, res) => {
    res.redirect(302, "/docs/uni/");
  });

  app.get("/aggregator-adm", (_req, res) => sendIndex("aggregator_adm", res));
  app.get("/aggregator-adm/", (_req, res) => sendIndex("aggregator_adm", res));
  app.use("/aggregator-adm", express.static(path.join(repoRoot, "aggregator_adm")));
  app.get("/admin-panel", (_req, res) => sendIndex("admin", res));
  app.get("/admin-panel/", (_req, res) => sendIndex("admin", res));
  app.use("/admin-panel", express.static(path.join(repoRoot, "admin")));

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
  app.use("/api/v1", uniRoutes);
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
    console.log(`[REST] Admin UI:  http://localhost:${env.PORT}/admin-panel/  (${path.join(repoRoot, "admin")})`);
    console.log(`[REST] Aggregator ADM: http://localhost:${env.PORT}/aggregator-adm/  (${path.join(repoRoot, "aggregator_adm")})`);
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
