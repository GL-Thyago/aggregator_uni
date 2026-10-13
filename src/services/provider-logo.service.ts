import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { sniffLogoMime } from "./salsa/salsa-logo.service.js";

const LOGOS_DIR = path.resolve(process.cwd(), "data", "provider-logos");

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function resolveProviderLogoUrl(provider: {
  slug: string;
  logoUrl?: string | null;
}): string | null {
  const raw = provider.logoUrl?.trim() ?? "";
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (raw.startsWith("/")) return `${base}${raw}`;
  return `${base}/api/v1/media/provider/${encodeURIComponent(provider.slug)}`;
}

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

export async function saveProviderLogoUpload(providerId: number, slug: string, imageDataUrl: string) {
  const parsed = parseDataUrl(imageDataUrl);
  if (!parsed) throw new Error("Envie uma imagem (PNG, JPG, WEBP ou SVG) em data URL");

  fs.mkdirSync(LOGOS_DIR, { recursive: true });
  const ext = MIME_EXT[parsed.mime] ?? "png";
  const filename = `${providerId}.${ext}`;
  for (const old of fs.readdirSync(LOGOS_DIR)) {
    if (old.startsWith(`${providerId}.`) && old !== filename) {
      try {
        fs.unlinkSync(path.join(LOGOS_DIR, old));
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(path.join(LOGOS_DIR, filename), parsed.buf);

  const logoUrl = `/api/v1/media/provider/${encodeURIComponent(slug)}`;
  const provider = await prisma.gameProvider.update({
    where: { id: providerId },
    data: { logoUrl },
  });
  return { ...provider, logoUrl: resolveProviderLogoUrl(provider) };
}

export async function getProviderLogoPayload(slug: string) {
  const decoded = decodeURIComponent(slug);
  const provider = await prisma.gameProvider.findFirst({
    where: { OR: [{ slug: decoded }, { slug }] },
    select: { id: true, slug: true, logoUrl: true },
  });
  if (!provider) return null;

  if (provider.logoUrl && /^https?:\/\//i.test(provider.logoUrl)) {
    return { redirect: provider.logoUrl };
  }

  if (!fs.existsSync(LOGOS_DIR)) return null;
  const files = fs.readdirSync(LOGOS_DIR).filter((f) => f.startsWith(`${provider.id}.`));
  const file = files[0];
  if (!file) return null;
  const buf = fs.readFileSync(path.join(LOGOS_DIR, file));
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime =
    Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? sniffLogoMime(buf);
  return { buffer: buf, contentType: mime };
}
