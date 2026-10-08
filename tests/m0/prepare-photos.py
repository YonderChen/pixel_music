"""Reproducible binary fixture build, not production image normalization.

Source files are explicit downloads. Canonical PNG and RGBA are saved for offline
tests. Browser tests must decode canonical PNG at 1:1, not claim Pillow=Canvas.
"""
import json
import hashlib
import sys
from pathlib import Path
from PIL import Image, ImageDraw, __version__ as pillow_version

project = Path(__file__).resolve().parents[2]
sources = json.loads((project / 'tests/m0/photo-sources.json').read_text())
target = project / 'tests/m0/photos'
target.mkdir(parents=True, exist_ok=True)
result = []
for item in sources['photos']:
    source = project / 'tests/artifacts/m0-photo-originals' / item['file']
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    if not item['sourceSha256'] or source_sha != item['sourceSha256']:
        raise ValueError('Missing or changed upstream checksum: ' + item['id'])
    with Image.open(source) as image:
        rgb = image.convert('RGB')
        width, height = rgb.size
        crop_width = min(width, height * 1.6)
        crop_height = crop_width / 1.6
        box = ((width-crop_width)/2, (height-crop_height)/2,
               (width+crop_width)/2, (height+crop_height)/2)
        canonical = rgb.resize((192,120), Image.Resampling.BILINEAR, box=box).convert('RGBA')
        png = target / (item['id'] + '.png')
        raw = target / (item['id'] + '.rgba')
        canonical.save(png, optimize=False)
        raw.write_bytes(canonical.tobytes())
        result.append({'id':item['id'],'sourceDimensions':[width,height],'cropBox':list(box),
            'normalizationVersion':'fixture-cover-pillow-bilinear-v1','pillowVersion':pillow_version,
            'sourceSha256':source_sha,'pngPath':str(png.relative_to(project)),
            'pngSha256':hashlib.sha256(png.read_bytes()).hexdigest(),
            'rgbaPath':str(raw.relative_to(project)),
            'rgbaSha256':hashlib.sha256(raw.read_bytes()).hexdigest()})
sheet = Image.new('RGB', (4*240, 3*180), '#eaeaea')
draw = ImageDraw.Draw(sheet)
for index, item in enumerate(result):
    x, y = index % 4 * 240, index // 4 * 180
    with Image.open(project / item['pngPath']) as tile:
        sheet.paste(tile.convert('RGB'), (x+24, y+10))
    draw.text((x+12,y+140), item['id'], fill='#111111')
sheet.save(project / 'tests/artifacts/m0-photo-contact-sheet.png')
print(json.dumps(result))
