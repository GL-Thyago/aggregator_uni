"""Download bundletvm from BR System CDN and export slot/button sprites."""
from __future__ import annotations

import json
from pathlib import Path

import UnityPy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "games" / "tv-milionario" / "assets"
SYMBOLS = OUT / "symbols"
BUTTONS = OUT / "buttons"
SYMBOLS.mkdir(parents=True, exist_ok=True)
BUTTONS.mkdir(parents=True, exist_ok=True)

URLS = [
    "https://jogosonline.top/tvm/bundletvm",
    "https://jogosonline.top/brjogos/bundletvm",
    "https://coffeweb.top/playstore/bundletvm",
]

def try_download() -> bytes | None:
    try:
        import urllib.request
    except ImportError:
        return None
    for url in URLS:
        try:
            print(f"Trying {url} ...")
            with urllib.request.urlopen(url, timeout=20) as resp:
                data = resp.read()
            if data[:6] == b"UnityF" or data[:4] == b"Unity":
                print(f"  OK {len(data)//1024} KB")
                return data
            print(f"  Not a Unity bundle ({data[:20]!r})")
        except Exception as exc:
            print(f"  Failed: {exc}")
    return None

def export_assets(data: bytes) -> dict[str, int]:
    env = UnityPy.load(data)
    counts = {"symbols": 0, "buttons": 0, "other": 0}
    symbol_map: dict[str, str] = {}

    for obj in env.objects:
        if obj.type.name not in ("Texture2D", "Sprite"):
            continue
        try:
            tex = obj.read()
            name = getattr(tex, "m_Name", "") or getattr(tex, "name", "") or ""
            img = tex.image
        except Exception:
            continue

        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:80]
        low = name.lower()

        if "_fig_" in low:
            # _FIG_01 = highest symbol
            idx = int("".join(c for c in name if c.isdigit()) or "0")
            fig_key = f"fig_{idx:02d}"
            path = SYMBOLS / f"{fig_key}.png"
            img.save(path)
            counts["symbols"] += 1
            symbol_map[fig_key] = path.name
            print(f"  symbol {name} -> {path.name}")
        elif low.startswith("bt_") or "bt_cash" in low or "bt_help" in low or "bt_lines" in low or "bt_bet" in low or "bt_quick" in low or "bt_init" in low:
            path = BUTTONS / f"{safe}.png"
            img.save(path)
            counts["buttons"] += 1
            print(f"  button {name} -> {path.name}")
        elif any(k in low for k in ("main", "msg_pierde", "msg_gana", "barbutton", "reels", "slot")):
            path = OUT / f"{safe}.png"
            img.save(path)
            counts["other"] += 1
            print(f"  ui {name} -> {path.name}")

    if symbol_map:
        (SYMBOLS / "fig_map.json").write_text(json.dumps(symbol_map, indent=2), encoding="utf-8")
    return counts

def main() -> None:
    bundle_path = ROOT / "extracted" / "tv-milionario" / "bundletvm"
    data = bundle_path.read_bytes() if bundle_path.exists() else None
    if not data:
        data = try_download()
        if data:
            bundle_path.write_bytes(data)

    if not data:
        print("bundletvm not available — slot symbols are downloaded at runtime on first app launch.")
        print("Place the file at extracted/tv-milionario/bundletvm and re-run this script.")
        return

    counts = export_assets(data)
    print("Exported:", counts)

if __name__ == "__main__":
    main()
