"""Refresh generated static-site files and optionally build the ZIP hand-off package.

The image engine is plain JavaScript in dist/engine/; nothing here compiles or bundles it.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse, shutil
root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
parser = argparse.ArgumentParser(); parser.add_argument('--archive', action='store_true'); args = parser.parse_args()
shutil.copyfile(root / 'vendor/photo_sonification/LICENSE.txt', dist / 'engine/licenses/LICENSE.photo-sonification.txt')
shutil.copyfile(dist / 'feature-music.html', dist / 'index.html')
if args.archive:
    names = ['index.html', 'feature-music.html', 'feature-music-app.js', 'browser-engine.js', 'sonification.css', 'sonification-samples.js',
             'sonification-assets/photos.js', 'sonification-assets/paintings.js', 'music-art.html', 'music-art-app.js', 'music-art-core.js',
             'music-art-midi.js', 'music-art-classics.js', 'music-art.css', 'ui.css', 'studio.css', 'favicon.svg', 'icon-192.png', 'icon-512.png',
             'icon-maskable-512.png', 'apple-touch-icon.png', 'site.webmanifest']
    paths = [dist / name for name in names] + sorted((dist / 'classical-midi').glob('*')) + sorted((dist / 'sonification-assets/paintings').glob('*')) + sorted((dist / 'engine').rglob('*'))
    archive = root / '图鸣-静态网页版.zip'
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=6) as z:
        for p in paths:
            if p.is_file(): z.write(p, str(p.relative_to(dist)))
        z.write(root / 'docs' / 'STATIC_WEB_DEMO.md', '使用说明.md')
    print('Static archive:', archive, archive.stat().st_size)
