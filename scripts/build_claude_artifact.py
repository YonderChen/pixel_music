"""Build dist/ into a folder that can be published as a claude.ai Artifact.

Usage: python3 scripts/build_claude_artifact.py [out_dir]   (default: build/claude-artifact)

The main page (index.html) is published without its own document skeleton because
the host wraps it in one. dist/ itself is left untouched.
"""
import re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build' / 'claude-artifact'
TITLE = '图鸣 Pixel Music'

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(DIST, OUT, ignore=shutil.ignore_patterns(
    '_headers',
    # Original MIDI files are only offered as downloads, which the Artifact viewer blocks.
    '*.mid'))

# The main page loses its document skeleton; the host supplies one.
index = OUT / 'index.html'
page = index.read_text()
page = re.sub(r'<!doctype html>\s*|</?html[^>]*>\s*|</?head>\s*|</?body>\s*', '', page, flags=re.I)
page = re.sub(r'<title>.*?</title>', f'<title>{TITLE}</title>', page, count=1)
index.write_text(page)

for path in sorted(OUT.rglob('*')):
    if path.is_file() and path.stat().st_size > 16 * 1024 * 1024:
        sys.exit(f'{path} is over the 16 MB Artifact file limit')
print(f'Built {OUT} ({sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1e6:.1f} MB)')
