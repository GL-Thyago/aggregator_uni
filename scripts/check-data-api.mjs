import fs from "node:fs";

const raw = fs.readFileSync("games/fortune-tiger/data.json", "utf8");
console.log("index.php count", (raw.match(/index\.php/g) || []).length);
console.log("api/v1/game count", (raw.match(/api\/v1\/game/g) || []).length);

const idx = raw.indexOf("NhutCorp_SlotGenPHP");
if (idx >= 0) {
  console.log("plugin area:", raw.slice(idx, idx + 500));
}
