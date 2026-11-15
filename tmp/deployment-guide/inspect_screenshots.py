import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(os.environ['TEMP']) / 'dja-deployment-guide-deps'))
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parent
ROOT.mkdir(parents=True, exist_ok=True)
SOURCE = Path.home() / 'Pictures' / 'Screenshots'
files = sorted(p for p in SOURCE.glob('*.png') if p.name.startswith(('Screenshot 2026-11-15', 'Screenshot 2026-11-16')))
# Internal visual inventory only. Original screenshots remain untouched.
for batch in range((len(files) + 23) // 24):
    selected = files[batch * 24: (batch + 1) * 24]
    sheet = Image.new('RGB', (1600, 6 * 260), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, file in enumerate(selected):
        x, y = (i % 4) * 400, (i // 4) * 260
        with Image.open(file) as picture:
            preview = ImageOps.contain(picture.convert('RGB'), (390, 225))
            sheet.paste(preview, (x, y))
        draw.text((x + 4, y + 230), f'{batch*24+i:03d} {file.stem[11:]}', fill='black')
    sheet.save(ROOT / f'inventory-{batch+1:02d}.jpg', quality=90)
print(f'{len(files)} screenshots; {(len(files)+23)//24} internal inventory sheets')
