"""Extract all sprites from scene bundle and slice sprite_02 atlas."""
from __future__ import annotations

from pathlib import Path

from PIL import Image
import UnityPy

ROOT = Path(__file__).resolve().parents[1] / "extracted" / "tv-milionario"
OUT = ROOT / "games-assets"
OUT.mkdir(parents=True, exist_ok=True)

# Export scene bundle
scene = ROOT / "apk" / "unpacked" / "assets" / "sceneassetbundle"
if scene.exists():
    env = UnityPy.load(str(scene))
    for obj in env.objects:
        if obj.type.name not in ("Texture2D", "Sprite"):
            continue
        try:
            data = obj.read()
            img = data.image
            name = getattr(data, "m_Name", "") or "tex"
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
            img.save(OUT / f"scene_{safe}.png")
            print(f"scene: {name} {img.size}")
        except Exception as exc:
            print(f"scene skip: {exc}")

# Inspect sprite_02 atlas
src = ROOT / "exported" / "sprite_02.png"
if src.exists():
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    print(f"\nsprite_02 size: {w}x{h}")

    # Try vertical strip (10 symbols)
    for count in (10, 8, 6, 5, 3):
        sh = h // count
        if sh < 20:
            continue
        slice_dir = OUT / f"sprite_02_x{count}"
        slice_dir.mkdir(exist_ok=True)
        for i in range(count):
            box = (0, i * sh, w, (i + 1) * sh if i < count - 1 else h)
            crop = img.crop(box)
            crop.save(slice_dir / f"sym_{i:02d}.png")
        print(f"  sliced into {count} parts ({sh}px each) -> {slice_dir.name}/")

# Copy key UI assets to games folder
GAME_ASSETS = Path(__file__).resolve().parents[1] / "games" / "tv-milionario" / "assets"
GAME_ASSETS.mkdir(parents=True, exist_ok=True)

copies = [
    ("exported/backgroundTvMilionarios.png", "background.png"),
    ("exported/barbuttons.png", "barbuttons.png"),
    ("exported/frameGoldMachine.png", "frame.png"),
    ("exported/256.png", "logo.png"),
    ("exported/sprite_02.png", "symbols_atlas.png"),
]
for src_rel, dst in copies:
    s = ROOT / src_rel
    if s.exists():
        import shutil
        shutil.copy2(s, GAME_ASSETS / dst)
        print(f"copied {dst}")
