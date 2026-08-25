import fs from "node:fs";
import path from "node:path";
import { resolveGamesDir } from "./game.service.js";

const iconsCache = new Map<string, unknown[]>();

export function loadGameIcons(assetPath: string): unknown[] {
  const cached = iconsCache.get(assetPath);
  if (cached) return cached;

  const iconsFile = path.join(resolveGamesDir(), assetPath, "api", "endpoints", "icons.php");
  if (!fs.existsSync(iconsFile)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(iconsFile, "utf8")) as { data?: unknown[] };
    const icons = Array.isArray(raw.data) ? raw.data : [];
    iconsCache.set(assetPath, icons);
    return icons;
  } catch {
    return [];
  }
}
