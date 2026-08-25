"""Extract textures/sprites from TV Milionario Unity assets."""
from __future__ import annotations

import os
from pathlib import Path

import UnityPy

ROOT = Path(__file__).resolve().parents[1] / "extracted" / "tv-milionario"
ASSETS = ROOT / "apk" / "unpacked" / "assets"
OUT = ROOT / "exported"
OUT.mkdir(parents=True, exist_ok=True)

TARGETS = [
    ASSETS / "bin" / "Data" / "data.unity3d",
    ASSETS / "bundlehallo",
    ASSETS / "sceneassetbundle",
    ASSETS / "textureassetbundle",
    ASSETS / "bin" / "Data" / "sharedassets0.resource",
]

keywords = (
    "milion", "million", "tv", "slot", "symbol", "pay", "line", "bonus",
    "halloween", "ice", "resource", "sprite", "texture", "icon", "reel",
)

exported = 0
names: list[str] = []

for target in TARGETS:
    if not target.exists():
        print(f"[skip] missing {target.name}")
        continue

    print(f"\n=== {target.name} ({target.stat().st_size // 1024} KB) ===")
    try:
        env = UnityPy.load(str(target))
    except Exception as exc:
        print(f"  load error: {exc}")
        continue

    for obj in env.objects:
        try:
            data = obj.read()
        except Exception:
            continue

        name = getattr(data, "m_Name", "") or getattr(data, "name", "") or obj.type.name
        type_name = obj.type.name

        if type_name == "Texture2D":
            try:
                img = data.image
            except Exception:
                continue
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:80] or f"tex_{exported}"
            out_path = OUT / f"{safe}.png"
            img.save(out_path)
            exported += 1
            names.append(f"{type_name}:{name}")
            print(f"  texture -> {out_path.name}")

        elif type_name == "Sprite":
            try:
                img = data.image
            except Exception:
                continue
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:80] or f"spr_{exported}"
            out_path = OUT / f"{safe}.png"
            img.save(out_path)
            exported += 1
            names.append(f"{type_name}:{name}")
            print(f"  sprite  -> {out_path.name}")

        elif type_name in ("TextAsset", "MonoBehaviour", "GameObject"):
            text = getattr(data, "m_Script", None) or getattr(data, "text", None) or ""
            blob = str(text).lower()
            if any(k in name.lower() or k in blob for k in keywords):
                safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:80]
                out_path = OUT / f"{type_name}_{safe or exported}.txt"
                out_path.write_text(str(text)[:50000], encoding="utf-8", errors="replace")
                print(f"  {type_name} -> {out_path.name}")

print(f"\nExported {exported} images to {OUT}")
