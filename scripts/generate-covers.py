#!/usr/bin/env python3
"""Gera cover.jpg (640x360) a partir de assets reais de cada jogo."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Instale: pip install Pillow")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
GAMES_DIR = ROOT / "games"
UNI_CLIENT = Path(r"C:\projeto_uni\uni_cliente")
CLIENT_COVERS = UNI_CLIENT / "public" / "cassino" / "covers"
CLIENT_MODALIDADES = UNI_CLIENT / "public" / "modalidades"
COVER_SIZE = (640, 360)
QUALITY = 88

# Asset principal por jogo (relativo à pasta do jogo)
COVER_SOURCES: dict[str, str | None] = {
    "fortune-tiger": "mg.png",
    "fortune-mouse": "mg.png",
    "fortune-rabbit": "mg.png",
    "bikini-paradise": "mg.png",
    "phoenix": "bg_phoenix_2.png",
    "tv-milionario": "assets/backgroundMainWindow2.png",
    "aviator": None,
    "dice": None,
    "coinflip": None,
    "double": None,
}

SCREENSHOT_SLUGS = ["aviator", "dice", "coinflip", "double"]
AGGREGATOR_URL = "http://localhost:3010"


def crop_cover(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    target_ratio = COVER_SIZE[0] / COVER_SIZE[1]
    current_ratio = w / h
    if current_ratio > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    return img.resize(COVER_SIZE, Image.Resampling.LANCZOS)


def save_cover(img: Image.Image, slug: str) -> None:
    game_dir = GAMES_DIR / slug
    client_path = CLIENT_COVERS / f"{slug}.jpg"
    CLIENT_COVERS.mkdir(parents=True, exist_ok=True)

    for out in [game_dir / "cover.jpg", client_path]:
        if out.parent.exists() or out == client_path:
            out.parent.mkdir(parents=True, exist_ok=True)
            img.save(out, "JPEG", quality=QUALITY, optimize=True)
            print(f"  -> {out}")


def from_asset(slug: str, rel: str) -> bool:
    src = GAMES_DIR / slug / rel
    if not src.is_file() or src.stat().st_size < 1024:
        return False
    img = Image.open(src)
    save_cover(crop_cover(img), slug)
    print(f"[ok] {slug} <- {rel}")
    return True


def cover_from_game(slug: str) -> bool:
    candidates = {
        "fortune-tiger": ["mg.png"],
        "fortune-mouse": ["mg.png"],
        "fortune-rabbit": ["mg.png", "avatar.png", "bg_phoenix_2.png"],
        "bikini-paradise": ["mg.png", "mg_2.png"],
        "phoenix": ["bg_phoenix_2.png", "bg_phoenix.png"],
        "tv-milionario": ["assets/backgroundMainWindow2.png", "assets/backgroundMainWindow.png"],
    }.get(slug, [])

    for rel in candidates:
        if from_asset(slug, rel):
            return True
    return False


def screenshot_instant(slug: str) -> bool:
    out = GAMES_DIR / slug / "cover.jpg"
    url = f"{AGGREGATOR_URL}/games/{slug}/index.html"
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 640, "height": 360})
            page.goto(url, wait_until="networkidle", timeout=15000)
            page.wait_for_timeout(1500)
            tmp = out.with_suffix(".png")
            page.screenshot(path=str(tmp), type="png")
            browser.close()
        img = Image.open(tmp)
        save_cover(crop_cover(img), slug)
        tmp.unlink(missing_ok=True)
        print(f"[screenshot] {slug}")
        return True
    except Exception as e:
        print(f"[screenshot fail] {slug}: {e}")
        return False


def fallback_dark(slug: str, title: str) -> None:
    from PIL import ImageDraw, ImageFont

    img = Image.new("RGB", COVER_SIZE, (15, 23, 42))
    draw = ImageDraw.Draw(img)
    w, h = COVER_SIZE
    draw.rectangle([0, h - 4, w, h], fill=(22, 163, 74))
    try:
        font = ImageFont.truetype("arial.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    draw.text((24, COVER_SIZE[1] - 48), title, fill=(248, 250, 252), font=font)
    save_cover(img, slug)
    print(f"[fallback] {slug}")


def modality_icon(key: str, title: str, accent: tuple[int, int, int]) -> None:
    from PIL import ImageDraw, ImageFont

    CLIENT_MODALIDADES.mkdir(parents=True, exist_ok=True)
    size = (128, 128)
    img = Image.new("RGB", size, (15, 23, 42))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([(8, 8), (120, 120)], radius=16, outline=accent, width=2)
    draw.rectangle([(8, 100), (120, 120)], fill=accent)
    try:
        font = ImageFont.truetype("arial.ttf", 22)
        small = ImageFont.truetype("arial.ttf", 11)
    except OSError:
        font = ImageFont.load_default()
        small = font
    draw.text((16, 36), title[:1], fill=accent, font=font)
    draw.text((16, 72), title[:8], fill=(203, 213, 225), font=small)
    img.save(CLIENT_MODALIDADES / f"{key}.jpg", "JPEG", quality=90)
    print(f"[modality] {key}.jpg")


def main() -> None:
    slot_games = [s for s, rel in COVER_SOURCES.items() if rel is not None]
    instant_games = SCREENSHOT_SLUGS

    for slug in slot_games:
        if not cover_from_game(slug):
            fallback_dark(slug, slug.replace("-", " ").title())

    for slug in instant_games:
        if not screenshot_instant(slug):
            fallback_dark(slug, slug.replace("-", " ").title())

    # Ícones das abas — estilo sóbrio
    modality_icon("rifa", "Ações", (22, 163, 74))
    modality_icon("bingo", "Bingo", (180, 140, 45))
    modality_icon("dezena", "Dezenas", (34, 197, 94))
    modality_icon("cassino", "Cassino", (180, 140, 45))

    manifest = {slug: f"/cassino/covers/{slug}.jpg" for slug in COVER_SOURCES}
    meta_path = CLIENT_COVERS / "manifest.json"
    meta_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Done.")


if __name__ == "__main__":
    main()
