import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma.js";
import { decodeSalsaThumbnail, sniffLogoMime } from "./salsa/salsa-logo.service.js";

const COVERS_DIR = path.resolve(process.cwd(), "data", "covers");

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function parseDataUrl(raw: string): { mime: string; buf: Buffer } | null {
  const match = raw.trim().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) return null;
  try {
    const buf = Buffer.from(match[2], "base64");
    if (buf.length < 24 || buf.length > 4_500_000) return null;
    const mime = match[1].startsWith("image/") ? match[1] : sniffLogoMime(buf);
    return { mime, buf };
  } catch {
    return null;
  }
}

function coverFileFor(gameId: number): string | null {
  if (!fs.existsSync(COVERS_DIR)) return null;
  return fs.readdirSync(COVERS_DIR).find((f) => f.startsWith(`${gameId}.`)) ?? null;
}

export async function saveGameCoverUpload(gameId: number, slug: string, imageDataUrl: string) {
  const parsed = parseDataUrl(imageDataUrl);
  if (!parsed) throw new Error("Envie uma imagem (PNG, JPG, WEBP ou GIF) em data URL");

  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const ext = MIME_EXT[parsed.mime] ?? "png";
  const filename = `${gameId}.${ext}`;
  for (const old of fs.readdirSync(COVERS_DIR)) {
    if (old.startsWith(`${gameId}.`) && old !== filename) {
      try {
        fs.unlinkSync(path.join(COVERS_DIR, old));
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(path.join(COVERS_DIR, filename), parsed.buf);

  const thumbnailUrl = `/api/v1/media/cover/${encodeURIComponent(slug)}`;
  return prisma.game.update({
    where: { id: gameId },
    data: { thumbnailUrl },
  });
}

export async function getGameCoverPayload(slug: string) {
  const decodedSlug = decodeURIComponent(slug);
  const game = await prisma.game.findFirst({
    where: {
      OR: [{ slug: decodedSlug }, { externalGameId: decodedSlug }, { slug }, { externalGameId: slug }],
    },
    select: { id: true, thumbnailUrl: true },
  });
  if (!game) return null;

  const file = coverFileFor(game.id);
  if (file) {
    const buf = fs.readFileSync(path.join(COVERS_DIR, file));
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? sniffLogoMime(buf);
    return { buffer: buf, contentType: mime };
  }

  const decoded = decodeSalsaThumbnail(game.thumbnailUrl);
  if (decoded) {
    return { buffer: decoded.buffer, contentType: decoded.contentType };
  }

  if (game.thumbnailUrl && /^https:\/\//i.test(game.thumbnailUrl)) {
    return { redirect: game.thumbnailUrl };
  }

  return null;
}
