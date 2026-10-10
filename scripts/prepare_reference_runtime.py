"""Download verified public Homebrew bottles into this checkout; no global installation."""
import hashlib
import json
import pathlib
import subprocess
import tarfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.reference-runtime'

def get(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=90) as response:
        return response.read()

def main():
    RUNTIME.mkdir(exist_ok=True)
    sources = []
    packages = []
    for name in ['fluid-synth', 'portaudio', 'readline']:
        metadata = json.loads(get(f'https://formulae.brew.sh/api/formula/{name}.json'))
        bottle = metadata['bottle']['stable']['files']['arm64_tahoe']
        archive = RUNTIME / f'{name}.tar.gz'
        if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != bottle['sha256']:
            scope = f'repository:homebrew/core/{name}:pull'
            token = json.loads(get('https://ghcr.io/token?service=ghcr.io&scope=' + scope))['token']
            data = get(bottle['url'], {'Authorization': 'Bearer ' + token})
            assert hashlib.sha256(data).hexdigest() == bottle['sha256']
            archive.write_bytes(data)
        folder = RUNTIME / 'packages'
        folder.mkdir(exist_ok=True)
        with tarfile.open(archive) as tar:
            tar.extractall(folder, filter='data')
        package = folder / name / metadata['versions']['stable']
        packages.append(package)
        sources.append({'name': name, 'license': metadata['license'], 'source': metadata['urls']['stable'], 'bottle': bottle})
        print('Prepared', name, flush=True)
    lib = RUNTIME / 'lib'; lib.mkdir(exist_ok=True)
    binaries = []
    for package in packages:
        for item in (package / 'lib').glob('*.dylib'):
            link = lib / item.name
            if not link.exists(): link.symlink_to(item)
            if not item.is_symlink(): binaries.append(item)
    executable = packages[0] / 'bin' / 'fluidsynth'
    binaries.append(executable)
    for binary in binaries:
        dependencies = subprocess.check_output(['otool', '-L', str(binary)], text=True).splitlines()[1:]
        for line in dependencies:
            dep = line.strip().split(' (', 1)[0]
            target = lib / pathlib.Path(dep).name
            if target.exists() and dep != str(target):
                subprocess.run(['install_name_tool', '-change', dep, str(target), str(binary)], check=True)
            elif '@@HOMEBREW_' in dep:
                resolved = dep.replace('@@HOMEBREW_PREFIX@@', '/opt/homebrew').replace('@@HOMEBREW_CELLAR@@', '/opt/homebrew/Cellar')
                if not pathlib.Path(resolved).exists():
                    raise RuntimeError('Missing local shared library: ' + resolved)
                subprocess.run(['install_name_tool', '-change', dep, resolved, str(binary)], check=True)
        subprocess.run(['codesign', '--force', '--sign', '-', str(binary)], check=True, capture_output=True)
    bindir = RUNTIME / 'bin'; bindir.mkdir(exist_ok=True)
    link = bindir / 'fluidsynth'
    if not link.exists(): link.symlink_to(executable)
    (RUNTIME / 'manifest.json').write_text(json.dumps(sources, indent=2) + '\n')
    subprocess.run([str(link), '--version'], check=True)

if __name__ == '__main__': main()
