"""Crop reel symbols from user reference photo + map extracted APK sprites."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REF = Path(
    r"C:\Users\raul2\.cursor\projects\c-Users-raul2-gl-aggregator\assets"
    r"\c__Users_raul2_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-31678964-985b-4858-a95d-bb1a8f0287fe.png"
)
OUT = ROOT / "games" / "tv-milionario" / "assets" / "symbols"
OUT.mkdir(parents=True, exist_ok=True)

# Manual crops on reference photo (5 cols x 3 rows grid area)
# Approximate pixel coords on the reference image ~1280x720 visible game area
CROPS = {
    "host_woman": (430, 195, 530, 310),
    "ring": (535, 195, 635, 310),
    "mansion": (640, 195, 740, 310),
    "cash": (745, 195, 845, 310),
    "camera": (850, 195, 950, 310),
    "clapper": (955, 195, 1055, 310),
    "host_man_row2": (430, 310, 530, 420),
    "jet": (640, 310, 740, 420),
    "yacht": (745, 310, 845, 420),
    "car": (850, 310, 950, 420),
}

if REF.exists():
    img = Image.open(REF).convert("RGBA")
    w, h = img.size
    print(f"Reference image: {w}x{h}")
    for name, box in CROPS.items():
        crop = img.crop(box)
        crop.save(OUT / f"{name}.png")
        print(f"  cropped {name}.png")

# Copy presenter from APK extraction
host_apk = ROOT / "extracted" / "tv-milionario" / "exported" / "sprite_02.png"
if host_apk.exists():
    import shutil
    shutil.copy2(host_apk, OUT / "host_man.png")
    print("  copied host_man.png from APK sprite_02")

# Map FIG order from game metadata (_FIG_01 highest pay typically)
FIG_MAP = {
    "host_man": "host_man.png",
    "host_woman": "host_woman.png",
    "jet": "jet.png",
    "yacht": "yacht.png",
    "mansion": "mansion.png",
    "car": "car.png",
    "ring": "ring.png",
    "cash": "cash.png",
    "camera": "camera.png",
    "clapper": "clapper.png",
}

manifest = OUT / "manifest.json"
import json
manifest.write_text(json.dumps(FIG_MAP, indent=2), encoding="utf-8")
print(f"Done -> {OUT}")
