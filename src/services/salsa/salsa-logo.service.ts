export function sniffLogoMime(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length >= 6 && buf.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF") return "image/webp";
  const head = buf.subarray(0, 64).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "image/png";
}

export function parseSalsaBase64Logo(raw: string): { mime: string; buf: Buffer } | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 32) return null;
  const dataUri = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  const mimeHint = dataUri?.[1];
  const b64 = (dataUri ? dataUri[2] : trimmed.replace(/\s/g, "")) ?? "";
  if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64.slice(0, 80))) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length <= 24) return null;
    return { mime: mimeHint && mimeHint.startsWith("image/") ? mimeHint : sniffLogoMime(buf), buf };
  } catch {
    return null;
  }
}

/** Converte o que a Salsa manda. Prefere gameLogoUrl (CMS) — mais leve que BASE64. */
export function salsaLogoToThumbnail(input: {
  gameLogoUrl?: string | null;
  gameLogo?: string | null;
}): string | null {
  const url = typeof input.gameLogoUrl === "string" ? input.gameLogoUrl.trim() : "";
  if (/^https?:\/\//i.test(url)) return url;

  if (typeof input.gameLogo !== "string") return null;
  if (/^https?:\/\//i.test(input.gameLogo.trim())) return input.gameLogo.trim();
  if (/^data:image\//i.test(input.gameLogo.trim()) && parseSalsaBase64Logo(input.gameLogo)) {
    return input.gameLogo.trim();
  }
  const parsed = parseSalsaBase64Logo(input.gameLogo);
  if (!parsed) return null;
  return `data:${parsed.mime};base64,${parsed.buf.toString("base64")}`;
}

export function decodeSalsaThumbnail(thumbnailUrl: string | null): { buffer: Buffer; contentType: string } | null {
  if (!thumbnailUrl) return null;
  if (/^https?:\/\//i.test(thumbnailUrl)) return null;
  const parsed = parseSalsaBase64Logo(thumbnailUrl);
  if (!parsed) return null;
  return { buffer: parsed.buf, contentType: parsed.mime };
}
