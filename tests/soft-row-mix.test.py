import hashlib, itertools, json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import reference_music as m
import numpy as np

checks = []
pinned = json.loads((m.VENDOR / 'UPSTREAM.json').read_text())
for name, digest in pinned['files'].items():
    assert hashlib.sha256((m.VENDOR / name).read_bytes()).hexdigest() == digest
checks.append('pinned upstream code remains byte-identical')

# The new timbres must retain the supplied fundamental, including low notes.
for row in range(4):
    for midi in (48, 60, 72, 84):
        e = {'start': 0, 'duration': .8, 'midi': midi, 'velocity': .7}
        samples, _ = m.soft_row_mixer.render_voice([e], m.soft_row_mixer.SR * 2, row, 4)
        mono = samples[4410:30870].sum(axis=1)
        spectrum = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
        hz = np.fft.rfftfreq(len(mono), 1 / 44100)[np.argmax(spectrum)]
        target = 440 * 2 ** ((midi - 69) / 12)
        assert abs(hz - target) < 2
        assert np.max(np.abs(samples[-4000:])) == 0
checks.append('all four soft timbres preserve the supplied fundamental and release into silence')

# A low-frequency input must contribute less to the echo than a midrange input.
echo_levels = []
for hz in (65, 900):
    t = np.arange(44100) / 44100
    x = np.zeros((88200, 2)); x[:44100] = (.1 * np.sin(2 * np.pi * hz * t))[:, None]
    echo = m.soft_row_mixer.light_echo(x) - x
    echo_levels.append(float(np.sqrt(np.mean(echo ** 2))))
assert echo_levels[0] < echo_levels[1] * .4
checks.append('echo rejects bass buildup while retaining midrange space')

photo = (m.ROOT / 'dist/sonification-assets/mars-sunset.png').read_bytes()
base, base_waves = m.build(photo)
p, waves, storage = m.build_with_parallel(photo)
for variant in ('reference', 'features'):
    assert p['variants'][variant] == base['variants'][variant]
    assert waves[variant] == base_waves[variant]
v = p['variants']['parallel']
assert v['mixProfiles']['soft']['voices'] == ['暖键', '柔拨弦', '圆木琴', '轻铃']
assert m.mix_row_stems(storage)[0] == waves['parallel']
assert m.mix_row_stems(storage, profile='soft')[0] == waves['parallel-soft']
assert waves['parallel'] != waves['parallel-soft']
score_hash = v['scoreSha256']
combinations = []
for bits in itertools.product((False, True), repeat=4):
    ids = [f'row-{i}' for i, enabled in enumerate(bits) if enabled]
    for backing in (False, True):
        wav, metrics = m.mix_row_stems(storage, ids, backing, 'soft')
        assert metrics['invalid'] == metrics['clipped'] == 0 and metrics['peak'] < .9
        assert metrics['seconds'] == v['duration']
        if not ids and not backing: assert metrics['peak'] == 0
        combinations.append(metrics['peak'])
assert score_hash == v['scoreSha256']
assert v['mixProfiles']['soft']['metrics']['rms'] > .03
checks.append('32 mute/background combinations: bounded peaks, finite samples, identical duration, true silence')
checks.append('full mixes reproducible; same image score; reference and snake WAVs unchanged')
report = {'status': 'passed', 'checkedOn': '2026-10-11', 'checks': checks, 'subjectivelyApproved': False,
    'referenceSite': 'https://playmusictheory.net/play', 'scoreSha256': score_hash,
    'original': v['metrics'], 'soft': v['mixProfiles']['soft']['metrics'], 'maximumSubsetPeak': max(combinations)}
(m.ROOT / 'tests/soft-row-mix-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
