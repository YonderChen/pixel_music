"""Development tool: render the three segmentation methods side by side.

Usage: python3 scripts/segment_preview.py [detail]   -> artifacts/segmentation/*.png
"""
import io, json, pathlib, sys, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import reference_music as engine
import segmentation

OUT = ROOT / 'artifacts' / 'segmentation'
PANEL_W, PANEL_H, LABEL_H = 384, 240, 28

def font(size):
    for path in ['/System/Library/Fonts/Hiragino Sans GB.ttc', '/System/Library/Fonts/STHeiti Medium.ttc']:
        try: return ImageFont.truetype(path, size)
        except OSError: pass
    return ImageFont.load_default()

def png(array):
    buffer = io.BytesIO(); Image.fromarray(array.astype(np.uint8)).save(buffer, format='PNG'); return buffer.getvalue()

def samples():
    assets = ROOT / 'dist' / 'sonification-assets'
    items = [(p.stem, p.read_bytes()) for p in sorted((assets / 'paintings').glob('*.jpg'))]
    items += [('mars-sunset', (assets / 'mars-sunset.png').read_bytes()), ('grass', (assets / 'grass.png').read_bytes())]
    yy, xx = np.mgrid[0:120, 0:192]
    items += [('white', png(np.full((120, 192, 3), 255))),
        ('gradient', png(np.repeat(np.linspace(0, 255, 192)[None, :, None], 120, 0).repeat(3, 2))),
        ('checker', png(((yy // 24 + xx // 24) % 2 * 255)[..., None].repeat(3, 2)))]
    return items

def render(result):
    labels = result['labels']
    colours = np.array([r['meanRgb'] for r in result['regions']])
    image = colours[labels]
    edge = np.zeros(labels.shape, bool)
    edge[:, :-1] |= labels[:, :-1] != labels[:, 1:]; edge[:-1, :] |= labels[:-1, :] != labels[1:, :]
    big = Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255)).resize((PANEL_W, PANEL_H), Image.NEAREST)
    lines = Image.fromarray(np.uint8(edge) * 255).resize((PANEL_W, PANEL_H), Image.NEAREST)
    big.paste((24, 24, 24), mask=lines)
    return big

def main():
    detail = float(sys.argv[1]) if len(sys.argv) > 1 else .5
    OUT.mkdir(parents=True, exist_ok=True)
    small, title = font(15), font(13)
    rows, summary = [], {}
    for name, data in samples():
        rgb = engine.upstream_analysis.analyze_image(engine.upstream_analysis.open_image_from_bytes(data), random_factor=0)['maps']['rgb']
        panels = [(Image.fromarray(np.uint8(np.clip(rgb, 0, 1) * 255)).resize((PANEL_W, PANEL_H), Image.LANCZOS), f'{name} · 原图')]
        summary[name] = {}
        for method in segmentation.METHODS:
            start = time.perf_counter(); result = segmentation.segment(rgb, method, detail); seconds = time.perf_counter() - start
            panels.append((render(result), f"{segmentation.METHOD_NAMES[method]} · {len(result['regions'])} 区域 · {seconds:.2f}s"))
            summary[name][method] = {'regions': len(result['regions']), 'seconds': round(seconds, 3)}
        row = Image.new('RGB', (PANEL_W * 4 + 50, PANEL_H + LABEL_H + 10), 'white')
        draw = ImageDraw.Draw(row)
        for i, (panel, label) in enumerate(panels):
            x = 10 + i * (PANEL_W + 10)
            row.paste(panel, (x, 5)); draw.text((x, PANEL_H + 10), label, fill=(30, 30, 30), font=small)
        row.save(OUT / f'{name}.png'); rows.append(row)
        print(name, summary[name])
    sheet = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 40), 'white')
    ImageDraw.Draw(sheet).text((10, 10), f'图鸣 · 区域分割对照（detail={detail}，分析图 192×120）', fill=(30, 30, 30), font=font(20))
    y = 40
    for r in rows: sheet.paste(r, (0, y)); y += r.height
    sheet.save(OUT / '_overview.png')
    (OUT / 'summary.json').write_text(json.dumps({'version': segmentation.VERSION, 'detail': detail, 'images': summary}, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
