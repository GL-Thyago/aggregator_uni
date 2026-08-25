"""Export unique 132x118 slot symbols from bundletvm."""
from __future__ import annotations

import hashlib
from pathlib import Path

import UnityPy

BUNDLE = Path(__file__).resolve().parents[1] / "extracted" / "tv-milionario" / "bundletvm"
OUT = Path(__file__).resolve().parents[1] / "games" / "tv-milionario" / "assets" / "symbols"
OUT.mkdir(parents=True, exist_ok=True)

data = BUNDLE.read_bytes()
env = UnityPy.load(data)
seen: dict[str, str] = {}
idx = 0

for obj in env.objects:
    if obj.type.name != "Sprite":
        continue
    try:
        tex = obj.read()
        name = getattr(tex, "m_Name", "") or ""
        img = tex.image
        if img.size != (132, 118):
            continue
        raw = img.tobytes()
        h = hashlib.md5(raw).hexdigest()[:12]
        if h in seen:
            continue
        seen[h] = name
        path = OUT / f"sym_{idx:02d}_{name}.png"
        img.save(path)
        print(f"{idx:02d} {name} -> {path.name}")
        idx += 1
    except Exception:
        pass

print(f"Unique symbols: {idx}")
