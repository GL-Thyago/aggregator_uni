"""List all Texture2D/Sprite names in TV Milionario data.unity3d."""
from pathlib import Path
import UnityPy

DATA = Path(__file__).resolve().parents[1] / "extracted" / "tv-milionario" / "apk" / "unpacked" / "assets" / "bin" / "Data" / "data.unity3d"
env = UnityPy.load(str(DATA))
names = set()
for obj in env.objects:
    if obj.type.name not in ("Texture2D", "Sprite"):
        continue
    try:
        data = obj.read()
        name = getattr(data, "m_Name", "") or getattr(data, "name", "") or ""
        if name:
            names.add(f"{obj.type.name}:{name}")
    except Exception:
        pass

for n in sorted(names):
    print(n)

print(f"\nTotal: {len(names)}")
