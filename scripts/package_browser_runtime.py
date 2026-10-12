"""Rebuild the self-contained browser assets from the pinned vendored inputs."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse, shutil, json, base64, hashlib
root=Path(__file__).resolve().parents[1]; v=root/'dist/browser-runtime/vendor'
parser=argparse.ArgumentParser(); parser.add_argument('--archive', action='store_true'); args=parser.parse_args()
lock=json.loads((v/'pyodide-lock.json').read_text()); binaries={}
for name in ['numpy','pillow']:
 assert hashlib.sha256((v/(name+'.whl')).read_bytes()).hexdigest()==lock['packages'][name]['sha256'], f'{name} release checksum mismatch'
for key,file in [('pyodide.asm.wasm','pyodide.asm.wasm'),('python_stdlib.zip','python_stdlib.zip'),(lock['packages']['numpy']['file_name'],'numpy.whl'),(lock['packages']['pillow']['file_name'],'pillow.whl')]:binaries[key]=base64.b64encode((v/file).read_bytes()).decode()
(v.parent/'compute-data.js').write_text('/* Offline browser runtime, fixed Pyodide 0.27.7. See THIRD_PARTY.md. */\nwindow.PixelMusicComputeAssets='+json.dumps(binaries,separators=(',',':'))+';\n')
(v.parent/'soundfont-data.js').write_text('/* GeneralUser GS: see LICENSE-GeneralUser-GS.txt. */\nwindow.PixelMusicSoundfontData='+json.dumps(base64.b64encode((root/'vendor/photo_sonification/soundfonts/GeneralUser-GS.sf2').read_bytes()).decode())+';\n')
files={str(p.relative_to(root)):p.read_text() for p in [*sorted((root/'vendor/photo_sonification').glob('*.py')),root/'scripts/reference_music.py',root/'scripts/soft_row_mixer.py',root/'scripts/hover_preview.py',root/'scripts/browser_engine.py']}
scripts={name:(v/name).read_text() for name in ['pyodide.js','pyodide.asm.js','libfluidsynth.js','js-synthesizer.js']}; scripts['pyodide-lock.json']=(v/'pyodide-lock.json').read_text()
(v.parent/'sources-data.js').write_text('/* Original pinned rules and local adapters, loaded inside a Worker. */\nwindow.PixelMusicRuntimeSources='+json.dumps({'scripts':scripts,'python':files},separators=(',',':'))+';\n')
shutil.copyfile(root/'vendor/photo_sonification/LICENSE.txt',v/'LICENSE.photo-sonification.txt');shutil.copyfile(root/'vendor/photo_sonification/soundfonts/LICENSE-GeneralUser-GS.txt',v/'LICENSE-GeneralUser-GS.txt')
shutil.copyfile(root/'dist/feature-music.html',root/'dist/index.html')
manifest={'version':'0.7.0','pyodide':'0.27.7','jsSynthesizer':'1.13.0','fluidSynth':'2.4.6','assets':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(v.parent.glob('*data.js'))}}
(v.parent/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Asset bundles:',[(p.name,p.stat().st_size) for p in v.parent.glob('*data.js')])
if args.archive:
 names=['index.html','feature-music.html','feature-music-app.js','browser-engine.js','sonification.css','sonification-samples.js','sonification-assets/photos.js','music-art.html','music-art-app.js','music-art-core.js','music-art-midi.js','music-art.css']
 paths=[root/'dist'/name for name in names]+list((root/'dist/browser-runtime').glob('*.js'))+[v.parent/'manifest.json',v.parent/'THIRD_PARTY.md']+sorted(v.glob('LICENSE*'))
 archive=root/'图鸣-静态网页版.zip'
 with ZipFile(archive,'w',compression=ZIP_DEFLATED,compresslevel=6) as z:
  for p in paths:z.write(p,str(p.relative_to(root/'dist')))
  z.write(root/'STATIC_WEB_DEMO.md','使用说明.md')
 print('Static archive:',archive,archive.stat().st_size)
