import fs from "node:fs";
import path from "node:path";

const GAMES_DIR = path.join(import.meta.dirname, "..", "games");

function patchServiceWorker(gameDir) {
  const swRegisterPath = path.join(gameDir, "scripts", "register-sw.js");
  if (!fs.existsSync(swRegisterPath)) return;

  const source = fs.readFileSync(swRegisterPath, "utf8");
  if (source.includes("localhost")) return;

  const patched = source.replace(
    "window.C3_RegisterSW=async function C3_RegisterSW(){if(!navigator.serviceWorker)return;",
    'window.C3_RegisterSW=async function C3_RegisterSW(){if(location.hostname==="localhost"||location.hostname==="127.0.0.1"){try{const regs=await navigator.serviceWorker.getRegistrations();for(const r of regs)await r.unregister()}catch(e){}return}if(!navigator.serviceWorker)return;',
  );
  fs.writeFileSync(swRegisterPath, patched, "utf8");
  console.log(`[sw] ${path.basename(gameDir)}`);
}

function bumpOffline(gameDir) {
  const offlinePath = path.join(gameDir, "offline.json");
  if (!fs.existsSync(offlinePath)) return;
  const offline = JSON.parse(fs.readFileSync(offlinePath, "utf8"));
  offline.version = Date.now();
  fs.writeFileSync(offlinePath, JSON.stringify(offline), "utf8");
  console.log(`[offline] ${path.basename(gameDir)} → ${offline.version}`);
}

for (const slug of fs.readdirSync(GAMES_DIR)) {
  const gameDir = path.join(GAMES_DIR, slug);
  if (!fs.statSync(gameDir).isDirectory()) continue;
  patchServiceWorker(gameDir);
  if (slug === "fortune-tiger") bumpOffline(gameDir);
}
