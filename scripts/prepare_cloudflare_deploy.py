"""Copy dist/ into a Cloudflare-ready folder (default: build/cloudflare).

Cloudflare static assets cap each file at 25 MiB, so the GS SoundFont is split into
parts (browser-engine.js joins them) and the base64 copy used only by file:// pages is left out.
"""
import json, shutil, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root/'build/cloudflare'
limit, part_size = 25*1024*1024, 20*1024*1024
font = 'GeneralUser-GS.sf2'

shutil.rmtree(out, ignore_errors=True)
shutil.copytree(root/'dist', out, ignore=shutil.ignore_patterns('.DS_Store', font, 'soundfont-data.js'))
data, runtime = (root/'dist/browser-runtime'/font).read_bytes(), out/'browser-runtime'
parts = []
for i in range(0, len(data), part_size):
    parts.append(f'{font}.part{len(parts)}')
    (runtime/parts[-1]).write_bytes(data[i:i+part_size])
(runtime/f'{font}.parts.json').write_text(json.dumps(parts))
# Runtime files are unversioned; a day of caching keeps repeat visits fast and updates visible soon.
(out/'_headers').write_text('/browser-runtime/*\n  Cache-Control: public, max-age=86400\n')

too_big = [str(p.relative_to(out)) for p in out.rglob('*') if p.is_file() and p.stat().st_size > limit]
if too_big: sys.exit(f'Files over 25 MiB: {too_big}')
print(f'{out}: {sum(1 for p in out.rglob("*") if p.is_file())} files, SoundFont in {len(parts)} parts')
