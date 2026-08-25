import fs from "node:fs";
import { prisma } from "../lib/prisma.js";
import { findStoredSalsaCover } from "./salsa/salsa-logo.service.js";

export function renderGameCoverSvg(name: string): string {
  const label = name.replace(/[<>&]/g, "").slice(0, 48) || "Jogo";
  const lines =
    label.length > 20 ? [label.slice(0, 20).trim(), label.slice(20, 40).trim()] : [label];
  const text = lines
    .map(
      (line, i) =>
        `<text x="50%" y="${48 + i * 14}%" fill="#f7fafc" font-size="20" font-family="Arial,sans-serif" font-weight="700" text-anchor="middle">${line}</text>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a202c"/>
      <stop offset="100%" stop-color="#2d3748"/>
    </linearGradient>
  </defs>
  <rect width="480" height="320" fill="url(#g)"/>
  <rect x="16" y="16" width="448" height="288" rx="16" fill="none" stroke="#4a5568" stroke-width="2"/>
  ${text}
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
    select: { name: true, thumbnailUrl: true },
  });
  if (!game) return null;

  if (game.thumbnailUrl && /^https:\/\//i.test(game.thumbnailUrl)) {
    return { redirect: game.thumbnailUrl };
  }

  return { svg: renderGameCoverSvg(game.name) };
}
