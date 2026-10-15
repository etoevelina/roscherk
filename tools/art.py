"""Производные 3D-графики дизайн-системы WORDS для приложения (docs/DESIGN.md).

Мастера — PNG с прозрачностью из пакета дизайн-системы (по 1,2–1,4 МБ). В приложение идут WebP
(альфа сохраняется) шириной 720 px — около 150 КБ на все шесть. Результат коммитится в
assets/art/, сборка копирует его в dist/art/ и в прекэш Service Worker.

    python3 -I tools/art.py ~/Downloads/outputs/words-design-system/assets
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'art')
# имя мастера → (ширина, качество)
ART = {
    'pearl-ribbon.png': (720, 80),
    'sage-loop.png': (720, 80),
    'lavender-orb.png': (600, 80),
    'glass-steps.png': (720, 80),
    'rose-folds.png': (720, 80),
    'map-backdrop.jpg': (720, 72),
}


def main(src):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, (width, quality) in ART.items():
        im = Image.open(os.path.join(src, name))
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA')
        im.thumbnail((width, width * 4), Image.LANCZOS)
        out = os.path.join(OUT, name.rsplit('.', 1)[0] + '.webp')
        im.save(out, 'WEBP', quality=quality, method=6)
        size = os.path.getsize(out)
        total += size
        print(f'{name} → assets/art/{os.path.basename(out)} {im.size[0]}×{im.size[1]} {size // 1024} КБ')
    print(f'всего {total // 1024} КБ')


if __name__ == '__main__':
    main(os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/Downloads/outputs/words-design-system/assets'))
