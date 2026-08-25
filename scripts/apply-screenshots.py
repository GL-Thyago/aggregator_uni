import sys
from pathlib import Path
from PIL import Image

COVER_SIZE = (640, 360)
QUALITY = 88

MAPPING = {
    "aviator": Path(r"c:\Users\raul2\AppData\Local\Temp\cursor\screenshots\page-2026-08-03T02-41-47-447Z.png"),
    "dice": Path(r"c:\Users\raul2\AppData\Local\Temp\cursor\screenshots\page-2026-08-03T02-42-12-071Z.png"),
    "coinflip": Path(r"c:\Users\raul2\AppData\Local\Temp\cursor\screenshots\page-2026-08-03T02-42-28-484Z.png"),
    "double": None,  # filled after double screenshot
}

GAMES_DIR = Path(r"C:\Users\raul2\gl\aggregator\games")
CLIENT = Path(r"C:\projeto_uni\uni_cliente\public\cassino\covers")


def crop_cover(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    tr = COVER_SIZE[0] / COVER_SIZE[1]
    cr = w / h
    if cr > tr:
        nw = int(h * tr)
        left = (w - nw) // 2
        img = img.crop((left, 0, left + nw, h))
    else:
        nh = int(w / tr)
        top = (h - nh) // 2
        img = img.crop((0, top, w, top + nh))
    return img.resize(COVER_SIZE, Image.Resampling.LANCZOS)


def save(slug: str, src: Path) -> None:
    img = crop_cover(Image.open(src))
    CLIENT.mkdir(parents=True, exist_ok=True)
    for out in [GAMES_DIR / slug / "cover.jpg", CLIENT / f"{slug}.jpg"]:
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "JPEG", quality=QUALITY, optimize=True)
        print(f"saved {out}")

if __name__ == "__main__":
    double_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if double_path:
        MAPPING["double"] = double_path
    for slug, path in MAPPING.items():
        if path and path.is_file():
            save(slug, path)
