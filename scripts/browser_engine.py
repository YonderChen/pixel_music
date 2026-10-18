"""Browser-only RPC adapter; runs in Pyodide inside a dedicated Web Worker.

Pinned analysis/composition and the existing mixers are imported unchanged.
"""
import base64
import dataclasses
import hashlib
import json
import pathlib
import sys

sys.path.insert(0, '/app/scripts')
import reference_music as engine
import hover_preview

ENTRIES = {}

def ensure_audio(cached, variant):
    if variant in cached['waves']:
        return cached['waves'][variant], cached['audioMetrics'][variant]
    payload, context = cached['payload'], cached['context']
    if variant in ('parallel', 'parallel-soft'):
        if context['backing'] and cached['background'] is None:
            cached['background'] = engine.render_backing(context)
        if variant == 'parallel-soft':
            wav, metrics, mixer, meta = engine.render_soft_rows(context, cached['background'])
            if cached['mixer'] is None: cached['mixer'] = mixer
            else: cached['mixer']['profiles'].update(mixer['profiles'])
            payload['variants']['parallel']['mixProfiles']['soft'].update(meta, metrics=metrics)
        else:
            wav, metrics, mixer, stems = engine.render_parallel(context['rowEvents'], context['reference'], context['info'], context['synth'], context['voices'], context['backing'], include_soft=False, background_wav=cached['background'])
            if cached['mixer'] is not None: mixer['profiles'].update(cached['mixer']['profiles'])
            cached['mixer'] = mixer
    elif variant in ('reference', 'features'):
        wav, metrics, _ = engine.render_score(payload['variants'][variant]['events'], context['info'], context['synth'])
    else: raise ValueError('未知音频版本')
    cached['waves'][variant], cached['audioMetrics'][variant] = wav, metrics
    return wav, metrics

def entry(key):
    if key not in ENTRIES: raise ValueError('乐谱已更新，请重新生成当前图片。')
    return ENTRIES[key]

def wave_reply(wav, metrics=None):
    pathlib.Path('/tmp/output.wav').write_bytes(wav)
    return json.dumps({'file': '/tmp/output.wav', 'metrics': metrics or {}})

def handle(raw):
    request = json.loads(raw)
    path, data = request['path'], request.get('data') or {}
    if path == '/api/health':
        return json.dumps({'engine': 'pixelmusic-browser-v1', 'offline': True})
    if path == '/api/performance':
        ref = data
        records = ref['events']
        if len(records) > 5000 or not 0 < ref['info']['duration'] <= 180: raise ValueError('乐谱超过本轮范围。')
        info = engine.CompositionInfo(**ref['info'])
        for record in records:
            if not (0 <= record['start'] <= 180 and 0 < record['duration'] <= 180 and 0 <= record['midi'] <= 127): raise ValueError('乐谱音符无效。')
        context = {'info': info, 'synth': ref['synth'], 'rowEvents': [e for e in records if e['layer'] == 'main'], 'reference': records, 'voices': ref['voices'], 'backing': ref['backing'], 'fixedMidi': engine.fixed_midi(ref['voices'])}
        cached = {'context': context, 'payload': {'variants': {'reference': {'events': records}, 'parallel': {'mixProfiles': {'soft': {}}}}}, 'waves': {}, 'audioMetrics': {}, 'mixer': None, 'background': None}
        if ref['variant'] == 'reference': return wave_reply(*ensure_audio(cached, 'reference'))
        ensure_audio(cached, 'parallel-soft' if ref['profile'] == 'soft' else 'parallel')
        return wave_reply(*engine.mix_row_stems(cached['mixer'], ref['rows'], ref['background'], ref['profile']))
    if path == '/api/generate':
        image = base64.b64decode(data['image'])
        options = data.get('options', {})
        key = hashlib.sha256(image + json.dumps(options, sort_keys=True).encode()).hexdigest()
        payload, context = engine.prepare_scores(image, options)
        payload['key'] = key
        payload['browserEngine'] = True
        for name, variant in payload['variants'].items(): variant['audioUrl'] = f'/api/audio/{key}/{name}.wav'
        for profile, meta in payload['variants']['parallel']['mixProfiles'].items():
            meta['audioUrl'] = f'/api/audio/{key}/parallel{"-soft" if profile == "soft" else ""}.wav'
        ENTRIES.clear()
        ENTRIES[key] = {'payload': payload, 'context': context, 'waves': {}, 'audioMetrics': {}, 'mixer': None, 'background': None, 'hoverBanks': {}}
        return json.dumps(payload)
    if path.startswith('/api/audio/'):
        parts = path.split('/')
        return wave_reply(*ensure_audio(entry(parts[3]), parts[4].removesuffix('.wav')))
    if path == '/api/rowmix':
        cached = entry(data['key'])
        profile = data.get('profile', 'original')
        ensure_audio(cached, 'parallel-soft' if profile == 'soft' else 'parallel')
        return wave_reply(*engine.mix_row_stems(cached['mixer'], data['rows'], data['background'], profile))
    if path == '/api/hover-bank':
        cached = entry(data['key'])
        variant = data['variant']
        profile = data['profile'] if variant == 'parallel' else 'original'
        key = variant + '-' + profile
        if key not in cached['hoverBanks']:
            with engine.arranged_midi(cached['context'].get('fixedMidi', False)):
                wav, meta = hover_preview.build(engine, cached['payload']['variants'][variant], cached['context']['info'], cached['context']['synth'], profile)
            meta['audioUrl'] = f'/api/hover-audio/{data["key"]}/{key}.wav'
            cached['hoverBanks'][key] = (wav, meta)
        return json.dumps(cached['hoverBanks'][key][1])
    if path.startswith('/api/hover-audio/'):
        parts = path.split('/')
        return wave_reply(entry(parts[3])['hoverBanks'][parts[4].removesuffix('.wav')][0])
    if path == '/api/preview':
        cached = entry(data['key'])
        variant = cached['payload']['variants'][data['variant']]
        record = next(e for e in variant['events'] if e.get('id') == data['eventId'])
        if data['variant'] == 'parallel' and data.get('profile') == 'soft':
            samples = engine.soft_row_mixer.preview(record, variant['rows'])
        else:
            event = engine.NoteEvent(0, min(.65, record['duration']), record['midi'], record['velocity'], record['instrument'], record['pan'], 'main')
            info = dataclasses.replace(cached['context']['info'], duration=.7)
            with engine.arranged_midi(cached['context'].get('fixedMidi', False)):
                samples, _ = engine.upstream_audio.render_backend([event], info, cached['context']['synth'])
        return wave_reply(engine.upstream_audio.audio_to_wav_bytes(samples, 44100))
    raise ValueError('未知浏览器计算操作')
