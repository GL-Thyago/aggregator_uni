"""Find TV Milionario slot symbol sprites in Unity assets."""
from __future__ import annotations

from pathlib import Path

import UnityPy

ROOT = Path(__file__).resolve().parents[1] / "extracted" / "tv-milionario"
DATA = ROOT / "apk" / "unpacked" / "assets" / "bin" / "Data" / "data.unity3d"
RES = ROOT / "apk" / "unpacked" / "assets" / "bin" / "Data" / "resources.resource"
OUT = ROOT / "exported" / "symbols"
OUT.mkdir(parents=True, exist_ok=True)

SLOT_KEYS = (
    "slot", "milion", "million", "tv", "symbol", "reel", "prize",
    "host", "present", "jet", "yacht", "mansion", "car", "ring",
    "cash", "camera", "clap", "ticket", "game", "bonus", "sprite_",
)

for target in (DATA, RES):
    if not target.exists():
        print(f"skip {target}")
        continue
    print(f"\n=== {target.name} ===")
    env = UnityPy.load(str(target))
    for obj in env.objects:
        if obj.type.name not in ("Texture2D", "Sprite"):
            continue
        try:
            data = obj.read()
        except Exception:
            continue
        name = getattr(data, "m_Name", "") or getattr(data, "name", "") or ""
        low = name.lower()
        if not any(k in low for k in SLOT_KEYS):
            continue
        try:
            img = data.image
        except Exception:
            continue
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:80]
        path = OUT / f"{safe}.png"
        img.save(path)
        print(f"  {obj.type.name}: {name} -> {path.name} ({img.size})")
