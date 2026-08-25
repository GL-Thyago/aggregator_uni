import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { findStoredSalsaCover } from "./salsa/salsa-logo.service.js";

const NATIVE_COVERS: Array<[string, string]> = [
  ["cover.svg", "image/svg+xml"],
  ["cover.png", "image/png"],
  ["cover.jpg", "image/jpeg"],
  ["cover.jpeg", "image/jpeg"],
  ["cover.webp", "image/webp"],
  ["icon.png", "image/png"],
];

export function findNativeGameCover(assetPath: string | null): { filePath: string; contentType: string } | null {
  if (!assetPath) return null;
  const dir = path.resolve(process.cwd(), env.GAMES_DIR, assetPath);
  if (!fs.existsSync(dir)) return null;
  for (const [file, contentType] of NATIVE_COVERS) {
    const filePath = path.join(dir, file);
    if (fs.existsSync(filePath)) return { filePath, contentType };
  }
  return null;
}

function hueFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function renderGameCoverSvg(name: string, provider?: string | null): string {
  const label = name.replace(/[<>&]/g, "").slice(0, 48) || "Jogo";
  const studio = (provider ?? "").replace(/[<>&]/g, "").slice(0, 28);
  const hue = hueFromString(`${studio}|${label}`);
  const c1 = `hsl(${hue} 55% 22%)`;
  const c2 = `hsl(${(hue + 28) % 360} 50% 12%)`;
  const accent = `hsl(${(hue + 40) % 360} 70% 62%)`;
  const lines = label.length > 22 ? [label.slice(0, 22).trim(), label.slice(22, 44).trim()] : [label];
  const text = lines
    .map(
      (line, i) =>
        `<text x="50%" y="${studio ? 46 + i * 12 : 50 + i * 14}%" fill="#f7fafc" font-size="22" font-family="Arial,sans-serif" font-weight="700" text-anchor="middle">${line}</text>`,
    )
    .join("");
  const studioText = studio
    ? `<text x="50%" y="78%" fill="${accent}" font-size="14" font-family="Arial,sans-serif" font-weight="600" text-anchor="middle" letter-spacing="1">${studio}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="480" height="320" fill="url(#g)"/>
  <circle cx="400" cy="40" r="90" fill="${accent}" opacity="0.18"/>
  <circle cx="40" cy="280" r="80" fill="${accent}" opacity="0.12"/>
  <rect x="16" y="16" width="448" height="288" rx="16" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>
  ${text}
  ${studioText}
</svg>`;
}

export async function getGameCoverPayload(slug: string) {
  const stored = findStoredSalsaCover(slug);
  if (stored) {
    return {
      buffer: fs.readFileSync(stored.filePath),
      contentType: stored.contentType,
    };
  }

  const game = await prisma.game.findUnique({
    where: { slug },
    select: {
      name: true,
      thumbnailUrl: true,
      assetPath: true,
      provider: { select: { name: true } },
    },
  });
  if (!game) return null;

  const native = findNativeGameCover(game.assetPath);
  if (native) {
    return {
      buffer: fs.readFileSync(native.filePath),
      contentType: native.contentType,
    };
  }

  if (game.thumbnailUrl && /^https:\/\//i.test(game.thumbnailUrl)) {
    return { redirect: game.thumbnailUrl };
  }

  return { svg: renderGameCoverSvg(game.name, game.provider?.name) };
}
