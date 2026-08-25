import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const GAMES_DIR = path.join(ROOT, "games");
const SOURCE_DIR = path.resolve(ROOT, "../projeto_uni/caca_uni/assets/games_");

const CATALOG_GAMES = [
  "fortune-tiger",
  "fortune-mouse",
  "fortune-rabbit",
  "bikini-paradise",
  "phoenix",
];

const TOKEN_BOOTSTRAP = `<script>
var userToken = "";
(function () {
  var params = new URLSearchParams(window.location.search);
  userToken = params.get("sessionToken") || params.get("token") || "";
})();
</script>
<script>
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
    });
  }
  if ("caches" in window) {
    caches.keys().then(function (keys) {
      keys.forEach(function (k) {
        if (k.indexOf("c3offline") === 0) caches.delete(k);
      });
    });
  }
}
</script>`;

const OLD_TOKEN_BLOCK =
  /<script>\s*var userToken[\s\S]*?<\/script>\s*(?=<meta|<link)/i;

function syncFromSource(slug) {
  const src = path.join(SOURCE_DIR, slug);
  const dest = path.join(GAMES_DIR, slug);
  if (!fs.existsSync(src)) {
    console.warn(`[skip sync] source missing: ${slug}`);
    return false;
  }
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log(`[sync] ${slug}`);
  return true;
}

function patchIndexHtml(gameDir, title) {
  const phpPath = path.join(gameDir, "index.php");
  const htmlPath = path.join(gameDir, "index.html");

  let html = fs.existsSync(htmlPath)
    ? fs.readFileSync(htmlPath, "utf8")
    : fs.existsSync(phpPath)
      ? fs.readFileSync(phpPath, "utf8")
      : null;

  if (!html) {
    console.warn(`[skip index] no entry point in ${path.basename(gameDir)}`);
    return;
  }

  if (OLD_TOKEN_BLOCK.test(html)) {
    html = html.replace(OLD_TOKEN_BLOCK, TOKEN_BOOTSTRAP + "\n");
  } else if (!html.includes("sessionToken")) {
    html = html.replace(/<head>/i, `<head>\n${TOKEN_BOOTSTRAP}\n`);
  }

  if (!html.includes("<title>") && title) {
    html = html.replace(/<head>/i, `<head>\n<title>${title}</title>`);
  }

  fs.writeFileSync(htmlPath, html, "utf8");
  console.log(`[index] ${path.basename(gameDir)}/index.html`);
}

function patchDataJson(gameDir) {
  const dataPath = path.join(gameDir, "data.json");
  if (!fs.existsSync(dataPath)) return false;

  let raw = fs.readFileSync(dataPath, "utf8");
  const before = raw;

  const NODE_API = "../../api/v1/game";

  raw = raw.replace(/\/public\/games_\/[^/"']+\/api\/index\.php\/?/g, NODE_API);
  raw = raw.replace(/https?:\/\/[^/"']+\/games[^/"']*\/api\/index\.php\/?/g, NODE_API);
  raw = raw.replace(/api\/index\.php/g, NODE_API);

  if (raw !== before) {
    fs.writeFileSync(dataPath, raw, "utf8");
    console.log(`[data] ${path.basename(gameDir)}/data.json → Node API (${NODE_API})`);
    return true;
  }
  return false;
}

function bumpOfflineCache(gameDir) {
  const offlinePath = path.join(gameDir, "offline.json");
  if (!fs.existsSync(offlinePath)) return;

  const offline = JSON.parse(fs.readFileSync(offlinePath, "utf8"));
  offline.version = Date.now();
  fs.writeFileSync(offlinePath, JSON.stringify(offline), "utf8");
  console.log(`[offline] ${path.basename(gameDir)}/offline.json version=${offline.version}`);
}

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
  console.log(`[sw] ${path.basename(gameDir)}/scripts/register-sw.js (skip localhost)`);
}

function main() {
  if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });

  for (const slug of CATALOG_GAMES) {
    syncFromSource(slug);
    const gameDir = path.join(GAMES_DIR, slug);
    if (!fs.existsSync(gameDir)) continue;
    patchIndexHtml(gameDir, slug);
    const dataPatched = patchDataJson(gameDir);
    if (dataPatched) bumpOfflineCache(gameDir);
    patchServiceWorker(gameDir);
  }

  console.log("\nDone. Catalog games:", CATALOG_GAMES.join(", "));
}

main();
