import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const GAMES_DIR = path.join(ROOT, "games");
const CLIENT_COVERS = path.resolve(ROOT, "../../projeto_uni/uni_cliente/public/cassino/covers");

const COVERS = {
  "fortune-tiger": { title: "Fortune Tiger", colors: ["#ea580c", "#ca8a04"], accent: "#fef08a" },
  "fortune-mouse": { title: "Fortune Mouse", colors: ["#7c3aed", "#db2777"], accent: "#fce7f3" },
  "fortune-rabbit": { title: "Fortune Rabbit", colors: ["#2563eb", "#7c3aed"], accent: "#e0e7ff" },
  "bikini-paradise": { title: "Bikini Paradise", colors: ["#0891b2", "#06b6d4"], accent: "#fef3c7" },
  phoenix: { title: "Phoenix Rises", colors: ["#dc2626", "#ea580c"], accent: "#fde68a" },
  "tv-milionario": { title: "TV Milionário", colors: ["#15803d", "#ca8a04"], accent: "#fef08a" },
  aviator: { title: "Aviator", colors: ["#1d4ed8", "#0ea5e9"], accent: "#fecaca" },
  dice: { title: "Dice", colors: ["#059669", "#10b981"], accent: "#ffffff" },
  coinflip: { title: "Coin Flip", colors: ["#b45309", "#fbbf24"], accent: "#fffbeb" },
  double: { title: "Double", colors: ["#991b1b", "#1f2937"], accent: "#f87171" },
};

function svgFor(slug, { title, colors, accent }) {
  const [c1, c2] = colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="240" fill="url(#bg)"/>
  <circle cx="320" cy="60" r="80" fill="${accent}" opacity="0.15"/>
  <circle cx="60" cy="190" r="70" fill="${accent}" opacity="0.12"/>
  <rect x="24" y="160" width="352" height="56" rx="12" fill="rgba(0,0,0,0.25)"/>
  <text x="200" y="198" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="22" font-weight="700">${title}</text>
  <text x="200" y="92" text-anchor="middle" fill="${accent}" font-family="Arial,sans-serif" font-size="48" font-weight="800" opacity="0.95">${title.split(" ").map(w=>w[0]).join("").slice(0,3)}</text>
</svg>`;
}

fs.mkdirSync(CLIENT_COVERS, { recursive: true });

for (const [slug, meta] of Object.entries(COVERS)) {
  const svg = svgFor(slug, meta);
  const gameDir = path.join(GAMES_DIR, slug);
  if (fs.existsSync(gameDir)) {
    fs.writeFileSync(path.join(gameDir, "cover.svg"), svg, "utf8");
    console.log("[cover]", slug, "→ games/");
  }
  fs.writeFileSync(path.join(CLIENT_COVERS, `${slug}.svg`), svg, "utf8");
  console.log("[cover]", slug, "→ uni_cliente/public/");
}

console.log("Done.");
