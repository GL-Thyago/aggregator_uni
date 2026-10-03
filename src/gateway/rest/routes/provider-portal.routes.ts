import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { providerPortalMiddleware } from "../../../auth/middleware.js";
import { ensureSchemaPatches, prisma } from "../../../lib/prisma.js";
import { serializeBigInt } from "../../../lib/utils.js";
import {
  authenticateProviderPortal,
  isProviderPortalConfigured,
} from "../../../services/provider-portal-auth.service.js";
import {
  isCatalogImageStorageConfigured,
  uploadCatalogImage,
} from "../../../services/catalog-image-storage.service.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

router.post("/auth/login", async (req, res) => {
  const parsed = z.object({ password: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres" });
    return;
  }
  const token = await authenticateProviderPortal(parsed.data.password);
  if (!token) {
    res.status(401).json({ error: "Senha inválida" });
    return;
  }
  res.json({ token, expiresIn: "8h" });
});

router.get("/status", async (_req, res) => {
  res.json({
    configured: await isProviderPortalConfigured(),
    storageConfigured: isCatalogImageStorageConfigured(),
  });
});

router.use(async (_req, _res, next) => {
  await ensureSchemaPatches();
  next();
});
router.use(providerPortalMiddleware);

router.get("/session", (_req, res) => {
  res.json({ ok: true, role: "provider-portal", storageConfigured: isCatalogImageStorageConfigured() });
});

router.get("/providers", async (_req, res) => {
  const providers = await prisma.gameProvider.findMany({
    where: { integration: "SALSA" },
    include: { _count: { select: { games: true } } },
    orderBy: { name: "asc" },
  });
  res.json(serializeBigInt(providers));
});

router.get("/providers/:id/games", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Provedor inválido" });
    return;
  }
  const provider = await prisma.gameProvider.findFirst({
    where: { id, integration: "SALSA" },
  });
  if (!provider) {
    res.status(404).json({ error: "Provedor não encontrado" });
    return;
  }
  const games = await prisma.game.findMany({
    where: { providerId: id },
    select: {
      id: true,
      slug: true,
      name: true,
      externalGameId: true,
      externalUrl: true,
      thumbnailUrl: true,
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(serializeBigInt({ provider, count: games.length, games }));
});

router.patch("/providers/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({
    defaultCostPct: z.number().min(0).max(50).optional(),
    logoUrl: z.string().url().max(2048).nullable().optional(),
  }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Provedor inválido" : parsed.error.flatten() });
    return;
  }
  const exists = await prisma.gameProvider.findFirst({ where: { id, integration: "SALSA" }, select: { id: true } });
  if (!exists) {
    res.status(404).json({ error: "Provedor não encontrado" });
    return;
  }
  const provider = await prisma.gameProvider.update({
    where: { id },
    data: {
      ...(parsed.data.defaultCostPct !== undefined && { defaultCostPct: parsed.data.defaultCostPct }),
      ...(parsed.data.logoUrl !== undefined && { logoUrl: parsed.data.logoUrl }),
    },
  });
  res.json(serializeBigInt(provider));
});

router.post("/providers/:id/apply-cost", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ costPct: z.number().min(0).max(50) }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "Provedor e comissão válidos são obrigatórios" });
    return;
  }
  const provider = await prisma.gameProvider.findFirst({ where: { id, integration: "SALSA" }, select: { id: true } });
  if (!provider) {
    res.status(404).json({ error: "Provedor não encontrado" });
    return;
  }
  const { applyProviderCostToGames } = await import("../../../services/salsa/salsa-sync.service.js");
  const result = await applyProviderCostToGames(id, parsed.data.costPct);
  res.json({ ok: true, gamesUpdated: result.count, costPct: parsed.data.costPct });
});

router.patch("/games/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({
    thumbnailUrl: z.string().url().max(2048).nullable().optional(),
    externalUrl: z.string().url().max(2048).nullable().optional(),
  }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Jogo inválido" : parsed.error.flatten() });
    return;
  }
  const game = await prisma.game.findFirst({
    where: { id, provider: { integration: "SALSA" } },
    select: { id: true },
  });
  if (!game) {
    res.status(404).json({ error: "Jogo não encontrado" });
    return;
  }
  res.json(await prisma.game.update({ where: { id }, data: parsed.data }));
});

router.post("/providers/:id/logo", upload.single("image"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !req.file) {
    res.status(400).json({ error: "Provedor e arquivo de imagem são obrigatórios" });
    return;
  }
  const provider = await prisma.gameProvider.findFirst({ where: { id, integration: "SALSA" }, select: { id: true } });
  if (!provider) {
    res.status(404).json({ error: "Provedor não encontrado" });
    return;
  }
  try {
    const logoUrl = await uploadCatalogImage({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      scope: "providers",
      entityId: id,
    });
    await prisma.gameProvider.update({ where: { id }, data: { logoUrl } });
    res.status(201).json({ logoUrl });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Falha no upload" });
  }
});

router.post("/games/:id/thumbnail", upload.single("image"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !req.file) {
    res.status(400).json({ error: "Jogo e arquivo de imagem são obrigatórios" });
    return;
  }
  const game = await prisma.game.findFirst({
    where: { id, provider: { integration: "SALSA" } },
    select: { id: true },
  });
  if (!game) {
    res.status(404).json({ error: "Jogo não encontrado" });
    return;
  }
  try {
    const thumbnailUrl = await uploadCatalogImage({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      scope: "games",
      entityId: id,
    });
    await prisma.game.update({ where: { id }, data: { thumbnailUrl } });
    res.status(201).json({ thumbnailUrl });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Falha no upload" });
  }
});

export default router;
