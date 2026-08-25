import fs from "node:fs";
import path from "node:path";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function salsaCoversDir(): string {
  return path.resolve(process.cwd(), "data", "covers");
}

export function findStoredSalsaCover(slug: string): { filePath: string; contentType: string } | null {
  const dir = salsaCoversDir();
  if (!fs.existsSync(dir)) return null;
  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    const filePath = path.join(dir, `${slug}.${ext}`);
    if (fs.existsSync(filePath)) return { filePath, contentType: mime };
  }
  return null;
}

function sniffMime(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length >= 6 && buf.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF") return "image/webp";
  const head = buf.subarray(0, 64).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "image/png";
}

function parseBase64Logo(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 32) return null;
  const dataUri = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  const b64 = dataUri ? dataUri[2] : trimmed.replace(/\s/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64.slice(0, 80))) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.length > 24 ? buf : null;
  } catch {
    return null;
  }
}

export function persistSalsaLogo(
  slug: string,
  input: { gameLogoUrl?: string | null; gameLogo?: string | null },
): string | null {
  const url = typeof input.gameLogoUrl === "string" ? input.gameLogoUrl.trim() : "";
  if (/^https?:\/\//i.test(url)) return url;

  if (typeof input.gameLogo !== "string") return null;
  const buf = parseBase64Logo(input.gameLogo);
  if (!buf) return null;

  const mime = sniffMime(buf);
  const ext = MIME_EXT[mime] ?? "png";
  const dir = salsaCoversDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.${ext}`), buf);
  return null;
}
