"""Build dist/ into a folder that can be published as a claude.ai Artifact.

Usage: python3 scripts/build_claude_artifact.py [out_dir]   (default: build/claude-artifact)

The Artifact host limits each text file to 16 MB, so the 22 MB compute-data.js
is split into one script per runtime asset group, and browser-engine.js loads
all of them. The main page (index.html) is published without its own document
skeleton because the host wraps it in one. dist/ itself is left untouched.
"""
import json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build' / 'claude-artifact'
LIMIT = 15 * 1024 * 1024
TITLE = '图鸣 Pixel Music'

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(DIST, OUT, ignore=shutil.ignore_patterns(
    '_headers', 'compute-data.js',
    # Already embedded in the compute-data and sources-data scripts; only the licenses stay.
    '*.whl', '*.wasm', '*.zip', 'pyodide*.js', 'pyodide-lock.json',
    # Original MIDI files are only offered as downloads, which the Artifact viewer blocks.
    '*.mid'))

# Split compute-data.js into chunks that each assign into the same global.
source = (DIST / 'browser-runtime' / 'compute-data.js').read_text()
assets = json.loads(source[source.index('=') + 1:].strip().rstrip(';'))
chunks, current = [], {}
for name, data in sorted(assets.items(), key=lambda item: -len(item[1])):
    if current and sum(map(len, current.values())) + len(data) > LIMIT:
        chunks.append(current); current = {}
    current[name] = data
chunks.append(current)
names = []
for index, chunk in enumerate(chunks, 1):
    name = f'compute-data-{index}.js'
    (OUT / 'browser-runtime' / name).write_text(
        '/* Offline browser runtime, fixed Pyodide 0.27.7. See THIRD_PARTY.md. */\n'
        'window.PixelMusicComputeAssets=Object.assign(window.PixelMusicComputeAssets||{},'
        + json.dumps(chunk, separators=(',', ':')) + ');\n')
    names.append(name)

engine = OUT / 'browser-engine.js'
old = "load('compute-data.js', 'PixelMusicComputeAssets')"
text = engine.read_text()
assert old in text, 'browser-engine.js no longer loads compute-data.js the expected way'
loads = ', '.join(f"load('{name}', 'PixelMusicComputeAssets')" for name in names)
engine.write_text(text.replace(old, f'Promise.all([{loads}]).then(() => window.PixelMusicComputeAssets)'))

# The main page loses its document skeleton; the host supplies one.
index = OUT / 'index.html'
page = index.read_text()
page = re.sub(r'<!doctype html>\s*|</?html[^>]*>\s*|</?head>\s*|</?body>\s*', '', page, flags=re.I)
page = re.sub(r'<title>.*?</title>', f'<title>{TITLE}</title>', page, count=1)
index.write_text(page)

for path in sorted(OUT.rglob('*')):
    if path.is_file() and path.stat().st_size > 16 * 1024 * 1024:
        sys.exit(f'{path} is over the 16 MB Artifact file limit')
print(f'Built {OUT} ({sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1e6:.1f} MB, chunks: {", ".join(names)})')
