import fs from "node:fs";
import path from "node:path";

const gamesDir = "games";
const slugs = fs.readdirSync(gamesDir).filter((d) =>
  fs.existsSync(path.join(gamesDir, d, "data.json")),
);

for (const slug of slugs) {
  const raw = fs.readFileSync(`games/${slug}/data.json`, "utf8");
  const idx = raw.indexOf("../../api/v1/game");
  if (idx < 0) {
    console.log(slug, "NO api path");
    continue;
  }
  const snippet = raw.slice(idx - 2, idx + 200);
  const match = snippet.match(/\[[^\]]+\]/);
  console.log(slug, match?.[0] ?? snippet.slice(0, 150));
}
