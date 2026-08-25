"""Extract Unity AssetBundles embedded in TV Milionario APK."""
from __future__ import annotations

import struct
from pathlib import Path

import UnityPy

APK = Path(__file__).resolve().parents[1] / "extracted" / "tv-milionario" / "xapk" / "com.brsystem.tvmilionariovideoslot.apk"
OUT_DIR = Path(__file__).resolve().parents[1] / "extracted" / "tv-milionario" / "bundles"
GAME_ASSETS = Path(__file__).resolve().parents[1] / "games" / "tv-milionario" / "assets"
OUT_DIR.mkdir(parents=True, exist_ok=True)
GAME_ASSETS.mkdir(parents=True, exist_ok=True)

data = APK.read_bytes()
magic = b"UnityFS"
offsets: list[int] = []
start = 0
while True:
    idx = data.find(magic, start)
    if idx < 0:
        break
    offsets.append(idx)
    start = idx + 1

print(f"Found {len(offsets)} UnityFS headers in APK")

# Unity bundle size: read header to get total file size (best-effort slice to next header or EOF)
slices: list[tuple[int, bytes]] = []
for i, off in enumerate(offsets):
    end = offsets[i + 1] if i + 1 < len(offsets) else len(data)
    chunk = data[off:end]
    slices.append((off, chunk))
    bundle_path = OUT_DIR / f"bundle_{off}.unity3d"
    bundle_path.write_bytes(chunk)
    print(f"  wrote {bundle_path.name} ({len(chunk)//1024} KB)")

SYMBOL_KEYS = ("_FIG_", "bt_cash_out", "bt_help", "bt_lines", "bt_bet", "bt_quick", "bt_init", "msg_pierde", "barbuttons", "MAIN")
exported = 0

for off, chunk in slices:
    try:
        env = UnityPy.load(chunk)
    except Exception as exc:
        print(f"  skip bundle@{off}: {exc}")
        continue

    for obj in env.objects:
        if obj.type.name not in ("Texture2D", "Sprite"):
            continue
        try:
            tex = obj.read()
            name = getattr(tex, "m_Name", "") or getattr(tex, "name", "") or ""
            if not any(k in name for k in SYMBOL_KEYS):
                continue
            img = tex.image
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:80]
            path = GAME_ASSETS / f"{safe}.png"
            img.save(path)
            exported += 1
            print(f"  export {name} {img.size} -> {path.name}")
        except Exception:
            pass

print(f"\nExported {exported} game assets to {GAME_ASSETS}")
