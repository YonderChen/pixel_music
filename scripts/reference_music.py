"""Use the pinned upstream engine, with an independent, auditable 2D melody adapter."""
from __future__ import annotations
import base64
import dataclasses
import hashlib
import io
import json
import math
import os
import pathlib
import sys
import wave
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'vendor' / 'photo_sonification'
sys.path.insert(0, str(VENDOR))
os.environ['PATH'] = str(ROOT / '.reference-runtime' / 'bin') + os.pathsep + os.environ.get('PATH', '')
import numpy as np
from PIL import Image
import audio as upstream_audio
import composition as upstream_composition
import image_analysis as upstream_analysis
from utils import NoteEvent, CompositionInfo
import soft_row_mixer

UPSTREAM_SHA = '667d97c1e68de56fe2f5ef2d26784ee8a7308f3f'
VERSION = 'full-image-features-v2'
PARALLEL_VERSION = 'horizontal-row-ensemble-v1'
WEIGHTS = np.array([.46, .20, .10, .12, .12])
FEATURE_NAMES = ['亮度', '色相', '饱和度', '对比度', '纹理']

def root_note(features):
    key = int(round(features['dominant_hue'] * 12)) % 12
    return int(np.clip(48 + key + round(-5 + 12 * features['mean_brightness']), 38, 58))

def original_composition(analysis, options=None):
    options = options or {}
    features = analysis['features']
    bars = int(options.get('bars') or upstream_composition.compute_bar_settings(features)[2])
    bars = max(4, min(16, bars))
    synth = options.get('synth', 'GeneralUser GS')
    if synth not in ['GeneralUser GS', 'Simple']: raise ValueError('未知音源')
    mapping = options.get('mapping', 'Scientific')
    if mapping not in ['Scientific', 'Balanced', 'Musical']: raise ValueError('未知映射模式')
    events, info = upstream_composition.generate_composition(
        analysis, bars, features['auto_complexity'], features['auto_variation_strength'], 'Automatic',
        synth, 'Automatic', 'Soft piano', 'Harp', 'Cello-like bass', 'Warm pad', 'Soft piano', 'Flute',
        mapping, None, 0.0, -2.0, 0.0, -8.0, -3.0, -1.0,
    )
    return events, info

def full_feature_melody(analysis, info):
    rgb, lum = analysis['maps']['rgb'], analysis['maps']['luminance']
    h, w = lum.shape
    cols, rows = info.bars * 2, 4
    slots = cols * rows
    slot_seconds = info.duration / slots
    allowed = upstream_composition.build_scale_notes(root_note(analysis['features']),
        upstream_composition.SCALES[info.scale_name], root_note(analysis['features']) + 10, root_note(analysis['features']) + 31)
    regions, events = [], []
    previous_vector = previous_midi = None
    for col in range(cols):
        for row in (range(rows) if col % 2 == 0 else reversed(range(rows))):
            sequence = len(regions)
            x0, x1 = round(col * w / cols), round((col + 1) * w / cols)
            y0, y1 = round(row * h / rows), round((row + 1) * h / rows)
            patch, light = rgb[y0:y1, x0:x1], lum[y0:y1, x0:x1]
            hsv = upstream_analysis.rgb_to_hsv_features(patch, light)
            edge, _ = upstream_analysis.compute_edge_map(light)
            brightness, contrast = float(np.mean(light)), float(np.std(light))
            entropy = upstream_analysis.normalized_histogram_entropy(edge)
            spectrum = upstream_analysis.analyze_fourier(light, random_factor=0, rng=np.random.default_rng(0))
            texture = .5 * entropy + .25 * spectrum['high_frequency_energy'] + .25 * spectrum['periodic_peak_score']
            hue, saturation = hsv['dominant_hue'], hsv['mean_saturation']
            # Hue controls scale position; achromatic patches have a neutral hue contribution.
            hue_position = .5 + (hue - .5) * saturation
            vector = np.array([brightness, hue_position, saturation, min(1, contrast * 3), texture])
            contributions = vector * WEIGHTS
            target_position = float(np.clip(np.sum(contributions), 0, 1))
            target = allowed[round(target_position * (len(allowed) - 1))]
            rect = {'x': x0 / w, 'y': y0 / h, 'width': (x1 - x0) / w, 'height': (y1 - y0) / h}
            region = {'id': f'cell-{sequence}', 'index': sequence, 'col': col, 'row': row, 'rect': rect,
                'start': sequence * slot_seconds, 'end': (sequence + 1) * slot_seconds,
                'features': {'brightness': brightness, 'hue': hue, 'saturation': saturation, 'contrast': contrast, 'texture': texture,
                    'entropy': entropy, 'highFrequency': spectrum['high_frequency_energy'], 'periodicity': spectrum['periodic_peak_score']},
                'contributions': dict(zip(FEATURE_NAMES, contributions.tolist())), 'targetMidi': target, 'midi': None, 'eventId': None}
            if brightness < .012:
                region['reason'] = '暗区主旋律休止'; regions.append(region); previous_vector = previous_midi = None; continue
            delta = None if previous_vector is None else float(np.sum(np.abs(vector - previous_vector) * WEIGHTS))
            candidates = allowed if previous_midi is None else [n for n in allowed if abs(n - previous_midi) <= 5]
            midi = min(candidates, key=lambda n: (abs(n - target), n))
            reason = '二维区域的颜色、明暗、对比度与纹理共同映射'
            if previous_midi is not None and delta < 1e-8:
                midi = previous_midi
                reason = '区域特征相同，保持同音'
            elif previous_midi is not None and delta >= .025 and midi == previous_midi:
                difference = vector - previous_vector
                dominant = int(np.argmax(np.abs(difference) * WEIGHTS))
                direction = 1 if difference[dominant] > 0 else -1
                neighbours = [n for n in candidates if (n - midi) * direction > 0]
                if neighbours:
                    midi = min(neighbours, key=lambda n: abs(n - previous_midi))
                    reason = '局部特征发生明显变化，保留一级音阶变化'
            elif midi != target:
                reason += '；压缩大跳进'
            region.update(midi=midi, reason=reason)
            velocity = float(np.clip(.30 + .30 * analysis['features']['dynamic_range'] + .20 * analysis['features']['contrast']
                + .15 * saturation + .25 * contrast, .28, .90))
            current = events[-1] if events else None
            # Merge only stable image features, not merely coincident quantized pitches.
            merge = current and current['midi'] == midi and abs(current['coverageEnd'] - region['start']) < 1e-7 and delta is not None and delta < .012
            if not merge:
                current = {'id': f'feature-main-{len(events)}', 'start': region['start'], 'duration': slot_seconds * .9,
                    'midi': midi, 'velocity': velocity, 'instrument': info.main_instrument, 'pan': (col / max(1, cols - 1) - .5) * .9,
                    'layer': 'main', 'sources': [], 'coverageEnd': region['end']}
                events.append(current)
            else:
                current['duration'] = region['end'] - current['start'] - slot_seconds * .1
                current['coverageEnd'] = region['end']
            current['sources'].append({'regionId': region['id'], 'rect': rect})
            region['eventId'] = current['id']
            regions.append(region); previous_vector, previous_midi = vector, midi
    return events, regions, cols, rows

def serialize_reference(events, analysis, info):
    h, w = analysis['maps']['luminance'].shape
    slices = upstream_composition.time_slice_statistics(analysis['maps']['luminance'], info.bars * 8)
    regions = []
    for index, stat in enumerate(slices):
        x0, x1 = round(index * w / len(slices)), max(round(index * w / len(slices)) + 1, round((index + 1) * w / len(slices)))
        regions.append({'id': f'ref-{index}', 'index': index, 'col': index, 'row': 0,
            'rect': {'x': x0 / w, 'y': 0, 'width': (x1 - x0) / w, 'height': 1},
            'start': index * .5 * 60 / info.tempo, 'end': (index + 1) * .5 * 60 / info.tempo,
            'features': {'brightness': stat['energy'], 'contrast': stat['contrast'], 'centroid': stat['y_centroid']},
            'midi': None, 'targetMidi': None, 'eventId': None, 'reason': '原项目未在此条带起音'})
    result = []
    for index, event in enumerate(events):
        row = dataclasses.asdict(event); row['id'] = f'ref-event-{index}'; row['sources'] = []
        if event.layer == 'main':
            source_index = min(len(slices) - 1, round(event.start / (60 / info.tempo) / .5))
            region = regions[source_index]
            region.update(midi=event.midi, targetMidi=event.midi, eventId=row['id'], reason='参考项目原始条带映射与段落变化')
            row['sources'] = [{'regionId': region['id'], 'rect': region['rect']}]
        result.append(row)
    return result, regions

def audio_metrics(samples, sr):
    peak = float(np.max(np.abs(samples)))
    return {'peak': peak, 'rms': float(np.sqrt(np.mean(samples ** 2))), 'invalid': int(np.sum(~np.isfinite(samples))),
        'clipped': int(np.sum(np.abs(samples) >= .98)), 'first12Rms': float(np.sqrt(np.mean(samples[:12 * sr] ** 2))),
        'seconds': len(samples) / sr}

def _local_features(rgb, luminance):
    # Duplicate boundaries for one-pixel regions; source geometry remains unchanged.
    light = luminance
    if light.shape[0] < 2: light = np.repeat(light, 2, axis=0)
    if light.shape[1] < 2: light = np.repeat(light, 2, axis=1)
    hsv = upstream_analysis.rgb_to_hsv_features(rgb, luminance)
    edge, _ = upstream_analysis.compute_edge_map(light)
    entropy = upstream_analysis.normalized_histogram_entropy(edge)
    spectrum = upstream_analysis.analyze_fourier(light, random_factor=0, rng=np.random.default_rng(0))
    texture = .5 * entropy + .25 * spectrum['high_frequency_energy'] + .25 * spectrum['periodic_peak_score']
    brightness, contrast = float(np.mean(luminance)), float(np.std(luminance))
    hue, saturation = hsv['dominant_hue'], hsv['mean_saturation']
    vector = np.array([brightness, .5 + (hue - .5) * saturation, saturation, min(1, contrast * 3), texture])
    features = {'brightness': brightness, 'hue': hue, 'saturation': saturation, 'contrast': contrast,
        'texture': texture, 'entropy': entropy, 'highFrequency': spectrum['high_frequency_energy'], 'periodicity': spectrum['periodic_peak_score']}
    return features, vector

def horizontal_row_melodies(analysis, info, options=None):
    options = options or {}
    count = int(options.get('rowCount', 4))
    method = options.get('rowMethod', 'reference')
    if count not in (2, 3, 4) or method not in ('reference', 'features'): raise ValueError('行数或行内映射设置无效')
    rgb, lum = analysis['maps']['rgb'], analysis['maps']['luminance']
    h, w = lum.shape
    if h < count: raise ValueError('图片高度不足以分割成所选行数')
    cols = min(info.bars * (8 if method == 'reference' else 4), w)
    allowed = upstream_composition.build_scale_notes(root_note(analysis['features']),
        upstream_composition.SCALES[info.scale_name], root_note(analysis['features']) + 10, root_note(analysis['features']) + 31)
    events, regions, voices = [], [], []
    for row in range(count):
        y0, y1 = round(row * h / count), round((row + 1) * h / count)
        row_rgb = rgb[y0:y1]
        stats_rgb = np.repeat(row_rgb, 2, axis=0) if row_rgb.shape[0] == 1 else row_rgb
        row_analysis = upstream_analysis.analyze_image(Image.fromarray(np.round(stats_rgb * 255).astype(np.uint8)), random_factor=0)
        f = row_analysis['features']
        synth = options.get('synth', 'GeneralUser GS')
        instrument = upstream_composition.choose_instruments(f, 'Automatic', synth)[0]
        voice_id = f'row-{row}'
        voices.append({'id': voice_id, 'row': row, 'name': f'第 {row + 1} 行', 'instrument': instrument,
            'instrumentName': upstream_composition.instrument_label(instrument), 'features': f,
            'rect': {'x': 0, 'y': y0/h, 'width': 1, 'height': (y1-y0)/h}})
        row_regions = []
        for col in range(cols):
            x0, x1 = round(col*w/cols), max(round(col*w/cols)+1, round((col+1)*w/cols))
            features, vector = _local_features(rgb[y0:y1,x0:x1], lum[y0:y1,x0:x1])
            region = {'id': f'parallel-{row}-{col}', 'index': len(regions), 'row': row, 'col': col, 'rowId': voice_id,
                'rect': {'x': x0/w, 'y': y0/h, 'width': (x1-x0)/w, 'height': (y1-y0)/h},
                'start': col*info.duration/cols, 'end': (col+1)*info.duration/cols, 'features': features,
                'contributions': dict(zip(FEATURE_NAMES,(vector*WEIGHTS).tolist())), 'targetMidi': None,
                'midi': None, 'eventId': None, 'reason': '此区域未产生起音'}
            row_regions.append(region); regions.append(region)
        previous = previous_vector = None
        row_events = []
        pan = -.4 + .8 * row / max(1, count-1)
        if method == 'reference':
            raw, _ = upstream_composition.generate_composition(row_analysis,info.bars,f['auto_complexity'],f['auto_variation_strength'],
                info.scale_name,synth,'Automatic','Soft piano','Harp','Cello-like bass','Warm pad','Soft piano','Flute',
                'Manual',info.tempo,0,-2,0,-8,-3,-1)
            transpose = root_note(analysis['features']) - root_note(f)
            for event in raw:
                if event.layer != 'main': continue
                col = min(cols-1, int(event.start/info.duration*cols + 1e-7))
                region = row_regions[col]
                target = event.midi + transpose
                candidates = allowed if previous is None else [n for n in allowed if abs(n-previous)<=5]
                midi = min(candidates,key=lambda n:(abs(n-target),n))
                record = dataclasses.asdict(event)
                record.update(id=f'{voice_id}-note-{len(row_events)}',midi=midi,rowId=voice_id,row=row,
                    pan=float(np.clip(.55*event.pan+.45*pan,-.75,.75)),
                    sources=[{'regionId':region['id'],'rect':region['rect']}])
                region.update(eventId=record['id'],midi=midi,targetMidi=target,
                    reason='行内参考条带法；统一到全图音阶与速度', originalMidi=event.midi)
                row_events.append(record); previous=midi
        else:
            for region in row_regions:
                features = region['features']
                vector = np.array([features['brightness'],.5+(features['hue']-.5)*features['saturation'],
                    features['saturation'],min(1,features['contrast']*3),features['texture']])
                target = allowed[round(float(np.clip(np.sum(vector*WEIGHTS),0,1))*(len(allowed)-1))]
                region['targetMidi'] = target
                if features['brightness'] < .012:
                    region['reason']='暗区主旋律休止';previous=previous_vector=None;continue
                delta=None if previous_vector is None else float(np.sum(np.abs(vector-previous_vector)*WEIGHTS))
                candidates=allowed if previous is None else [n for n in allowed if abs(n-previous)<=5]
                midi=min(candidates,key=lambda n:(abs(n-target),n))
                reason='本行局部颜色、明暗、对比度与纹理共同映射'
                if previous is not None and delta<1e-8: midi=previous;reason='本行区域特征稳定，保持同音'
                elif previous is not None and delta>=.025 and midi==previous:
                    difference=vector-previous_vector;dominant=int(np.argmax(np.abs(difference)*WEIGHTS))
                    direction=1 if difference[dominant]>0 else -1
                    choices=[n for n in candidates if (n-midi)*direction>0]
                    if choices: midi=min(choices,key=lambda n:abs(n-previous));reason='本行明显特征变化保留一级音阶变化'
                slot=info.duration/cols
                velocity=float(np.clip(.30+.30*f['dynamic_range']+.20*f['contrast']+.15*features['saturation']+.25*features['contrast'],.28,.90))
                last=row_events[-1] if row_events else None
                merge=last and last['midi']==midi and abs(last['coverageEnd']-region['start'])<1e-7 and delta is not None and delta<.012
                if not merge:
                    last={'id':f'{voice_id}-note-{len(row_events)}','start':region['start'],'duration':slot*.9,'midi':midi,
                        'velocity':velocity,'instrument':instrument,'pan':pan,'layer':'main','rowId':voice_id,'row':row,
                        'sources':[],'coverageEnd':region['end']}
                    row_events.append(last)
                else:
                    last['duration']=region['end']-last['start']-slot*.1;last['coverageEnd']=region['end']
                last['sources'].append({'regionId':region['id'],'rect':region['rect']})
                region.update(midi=midi,eventId=last['id'],reason=reason)
                previous,previous_vector=midi,vector
        voices[-1]['noteCount']=len(row_events)
        events.extend(row_events)
    events.sort(key=lambda e:(e['start'],e['row'],e['midi']))
    return events,regions,cols,count,voices

def _pcm(wav):
    with wave.open(io.BytesIO(wav),'rb') as reader:
        assert reader.getnchannels()==2 and reader.getframerate()==44100 and reader.getsampwidth()==2
        return np.frombuffer(reader.readframes(reader.getnframes()),dtype='<i2').reshape(-1,2).astype(np.float64)/32767

def mix_row_stems(storage, enabled_rows=None, include_background=True, profile='original'):
    ids=storage['rowIds'] if enabled_rows is None else enabled_rows
    if len(ids)!=len(set(ids)) or any(key not in storage['rowIds'] for key in ids): raise ValueError('声部选择无效')
    if profile not in ('original','soft'): raise ValueError('未知混音风格')
    source=storage if profile=='original' else storage['profiles']['soft']
    size=storage['frames'];samples=np.zeros((size,2))
    for key in ids:
        samples+=_pcm(source['wav'][key])*source['rowGain']
    if include_background and 'background' in source['wav']: samples+=_pcm(source['wav']['background'])
    # Keep the full-mix gain when muting rows; a solo is not secretly boosted.
    samples-=np.mean(samples,axis=0)
    samples=soft_row_mixer.master(samples,source['masterGain']) if profile=='soft' else np.clip(samples*source['masterGain'],-.98,.98)
    wav=upstream_audio.audio_to_wav_bytes(samples,44100)
    return wav,audio_metrics(samples,44100)

def render_parallel(events, reference, info, synth, voices, backing=True, include_soft=True, background_wav=None):
    stems={};metadata={};row_ids=[v['id'] for v in voices]
    for key in row_ids+(['background'] if backing else []):
        if key=='background' and background_wav is not None:
            stems[key]=background_wav
            metadata[key]={'metrics':audio_metrics(_pcm(background_wav),44100),'wavSha256':hashlib.sha256(background_wav).hexdigest(),
                'backend':'Shared reference backing, rendered once.'}
            continue
        records=[e for e in events if e.get('rowId')==key] if key!='background' else [e for e in reference if e['layer']!='main']
        raw=[NoteEvent(**{field:r[field] for field in ['start','duration','midi','velocity','instrument','pan','layer']}) for r in records]
        samples,message=upstream_audio.render_backend(raw,info,synth)
        if synth=='GeneralUser GS' and 'through FluidSynth' not in message: raise RuntimeError('多行 GS 音源未能启动')
        stems[key]=upstream_audio.audio_to_wav_bytes(upstream_audio.normalize_master_audio(samples),44100)
        metadata[key]={'metrics':audio_metrics(samples,44100),'wavSha256':hashlib.sha256(stems[key]).hexdigest(),'backend':message}
    frames=len(_pcm(stems[row_ids[0]]));row_gain=.8/math.sqrt(len(row_ids))
    full=np.zeros((frames,2))
    for key in row_ids: full+=_pcm(stems[key])*row_gain
    if 'background' in stems: full+=_pcm(stems['background'])
    dc=np.mean(full,axis=0);full-=dc
    rms=float(np.sqrt(np.mean(full**2)));master_gain=min(1,.16/max(rms,1e-12))
    bound=sum(float(np.max(np.abs(_pcm(stems[key]))))*row_gain for key in row_ids)
    if 'background' in stems: bound+=float(np.max(np.abs(_pcm(stems['background']))))
    master_gain=min(master_gain,.86/max(bound+1e-6,1e-12))
    storage={'wav':stems,'rowIds':row_ids,'frames':frames,'rowGain':row_gain,'masterGain':master_gain,'dc':dc.tolist()}
    storage['profiles']={}
    if include_soft:
        soft_stems,soft_gain,soft_meta=soft_row_mixer.prepare(events,row_ids,frames,_pcm(stems['background']) if 'background' in stems else None)
        storage['profiles']['soft']={'wav':{key:upstream_audio.audio_to_wav_bytes(data,44100) for key,data in soft_stems.items()},
            'rowGain':1,'masterGain':soft_gain,'metadata':soft_meta}
    wav,metrics=mix_row_stems(storage)
    return wav,metrics,storage,metadata

def build(image_bytes, options=None, include_parallel=False):
    options = options or {}
    image = upstream_analysis.open_image_from_bytes(image_bytes)
    analysis = upstream_analysis.analyze_image(image, random_factor=0)
    original, info = original_composition(analysis, options)
    reference, reference_regions = serialize_reference(original, analysis, info)
    feature_main, feature_regions, cols, rows = full_feature_melody(analysis, info)
    feature = [row for row in reference if row['layer'] != 'main'] + feature_main
    feature.sort(key=lambda row: (row['start'], row['layer'], row['midi']))
    synth = options.get('synth', 'GeneralUser GS')
    variants, waves = {}, {}
    for variant, records, regions, width, height in [('reference', reference, reference_regions, info.bars * 8, 1), ('features', feature, feature_regions, cols, rows)]:
        audible = [row for row in records if options.get('backing', True) or row['layer'] == 'main']
        events = [NoteEvent(**{name: row[name] for name in ['start','duration','midi','velocity','instrument','pan','layer']}) for row in audible]
        samples, message = upstream_audio.render_backend(events, info, synth)
        if synth == 'GeneralUser GS' and 'through FluidSynth' not in message:
            raise RuntimeError('GeneralUser GS 音源未能启动；请先运行准备脚本，或明确选择原版 Simple 音源。')
        # Match upstream UI's final master normalization as well.
        samples = upstream_audio.normalize_master_audio(samples)
        wav = upstream_audio.audio_to_wav_bytes(samples, 44100)
        waves[variant] = wav
        variants[variant] = {'events': audible, 'regions': regions, 'cols': width, 'rows': height,
            'mainCount': sum(row['layer'] == 'main' for row in audible), 'layerCounts': dict(Counter(row['layer'] for row in audible)),
            'duration': len(samples) / 44100, 'metrics': audio_metrics(samples, 44100), 'wavSha256': hashlib.sha256(wav).hexdigest(),
            'scoreSha256': hashlib.sha256(json.dumps(audible, sort_keys=True).encode()).hexdigest(), 'backend': message}
    parallel_storage=None
    if include_parallel:
        row_events,row_regions,row_cols,row_count,voices=horizontal_row_melodies(analysis,info,options)
        parallel_wav,metrics,parallel_storage,stems=render_parallel(row_events,reference,info,synth,voices,options.get('backing',True))
        audible=row_events+([e for e in reference if e['layer']!='main'] if options.get('backing',True) else [])
        audible.sort(key=lambda e:(e['start'],e['layer'],e['midi']))
        waves['parallel']=parallel_wav
        soft_wav,soft_metrics=mix_row_stems(parallel_storage,profile='soft')
        waves['parallel-soft']=soft_wav
        variants['parallel']={'version':PARALLEL_VERSION,'events':audible,'regions':row_regions,'cols':row_cols,'rows':row_count,
            'voices':voices,'rowMethod':options.get('rowMethod','reference'),'rowGain':parallel_storage['rowGain'],
            'duration':metrics['seconds'],'mainCount':len(row_events),'layerCounts':dict(Counter(e['layer'] for e in audible)),
            'metrics':metrics,'stems':stems,'wavSha256':hashlib.sha256(parallel_wav).hexdigest(),
            'scoreSha256':hashlib.sha256(json.dumps(audible,sort_keys=True).encode()).hexdigest(),
            'backend':'Each row rendered independently with the reference engine; shared backing mixed once.'}
        variants['parallel']['mixProfiles']={
            'original':{'name':'原有叠加','metrics':metrics,'wavSha256':hashlib.sha256(parallel_wav).hexdigest()},
            'soft':dict(parallel_storage['profiles']['soft']['metadata'],name='柔和合成混音',metrics=soft_metrics,
                wavSha256=hashlib.sha256(soft_wav).hexdigest())}
        for key,data in parallel_storage['wav'].items(): waves['parallel-'+key]=data
    rgb = np.clip(np.round(analysis['maps']['rgb'] * 255), 0, 255).astype(np.uint8)
    preview = io.BytesIO(); Image.fromarray(rgb).save(preview, format='PNG')
    payload = {'version': VERSION, 'upstream': UPSTREAM_SHA, 'info': dataclasses.asdict(info), 'features': analysis['features'],
        'settings': {'synth': synth, 'mapping': options.get('mapping','Scientific'), 'backing': options.get('backing',True), 'randomFactor': 0},
        'image': {'width': rgb.shape[1], 'height': rgb.shape[0], 'src': 'data:image/png;base64,' + base64.b64encode(preview.getvalue()).decode()},
        'variants': variants}
    return (payload, waves, parallel_storage) if include_parallel else (payload, waves)

def build_with_parallel(image_bytes, options=None):
    # Return mixer data separately; do not expose binary stems inside metadata JSON.
    return build(image_bytes,options,include_parallel=True)

def prepare_scores(image_bytes, options=None):
    """Prepare image and all scores without rendering any audio on page open."""
    options=options or {}
    image=upstream_analysis.open_image_from_bytes(image_bytes)
    analysis=upstream_analysis.analyze_image(image,random_factor=0)
    original,info=original_composition(analysis,options)
    reference,reference_regions=serialize_reference(original,analysis,info)
    feature_main,feature_regions,cols,rows=full_feature_melody(analysis,info)
    feature=[r for r in reference if r['layer']!='main']+feature_main
    feature.sort(key=lambda e:(e['start'],e['layer'],e['midi']))
    row_events,row_regions,row_cols,row_count,voices=horizontal_row_melodies(analysis,info,options)
    parallel=row_events+([e for e in reference if e['layer']!='main'] if options.get('backing',True) else [])
    parallel.sort(key=lambda e:(e['start'],e['layer'],e['midi']))
    duration=round((info.duration+.8)*44100)/44100
    variants={}
    for key,records,regions,width,height in [('reference',reference,reference_regions,info.bars*8,1),
            ('features',feature,feature_regions,cols,rows),('parallel',parallel,row_regions,row_cols,row_count)]:
        audible=[e for e in records if options.get('backing',True) or e['layer']=='main']
        variants[key]={'events':audible,'regions':regions,'cols':width,'rows':height,'duration':duration,
            'mainCount':sum(e['layer']=='main' for e in audible),'layerCounts':dict(Counter(e['layer'] for e in audible)),
            'scoreSha256':hashlib.sha256(json.dumps(audible,sort_keys=True).encode()).hexdigest(),'audioStatus':'on-demand'}
    variants['parallel'].update(version=PARALLEL_VERSION,voices=voices,rowMethod=options.get('rowMethod','reference'),
        mixProfiles={'original':{'name':'原有叠加'},'soft':{'name':'柔和合成混音','version':soft_row_mixer.VERSION,
            'voices':[soft_row_mixer.VOICES[i]['name'] for i in range(row_count)]}})
    rgb=np.clip(np.round(analysis['maps']['rgb']*255),0,255).astype(np.uint8)
    preview=io.BytesIO();Image.fromarray(rgb).save(preview,format='PNG')
    payload={'version':VERSION,'upstream':UPSTREAM_SHA,'info':dataclasses.asdict(info),'features':analysis['features'],
        'settings':{'synth':options.get('synth','GeneralUser GS'),'mapping':options.get('mapping','Scientific'),
            'backing':options.get('backing',True),'randomFactor':0},
        'image':{'width':rgb.shape[1],'height':rgb.shape[0],'src':'data:image/png;base64,'+base64.b64encode(preview.getvalue()).decode()},
        'variants':variants}
    context={'info':info,'synth':options.get('synth','GeneralUser GS'),'rowEvents':row_events,'reference':reference,
        'voices':voices,'backing':options.get('backing',True)}
    return payload,context

def render_score(records, info, synth):
    events=[NoteEvent(**{name:r[name] for name in ['start','duration','midi','velocity','instrument','pan','layer']}) for r in records]
    samples,message=upstream_audio.render_backend(events,info,synth)
    if synth=='GeneralUser GS' and 'through FluidSynth' not in message: raise RuntimeError('参考 GS 音源未能启动')
    samples=upstream_audio.normalize_master_audio(samples)
    return upstream_audio.audio_to_wav_bytes(samples,44100),audio_metrics(samples,44100),message

def render_soft_rows(context, background_wav=None):
    frames=round((context['info'].duration+.8)*44100)
    ids=[v['id'] for v in context['voices']]
    stems,gain,metadata=soft_row_mixer.prepare(context['rowEvents'],ids,frames,_pcm(background_wav) if background_wav is not None else None)
    storage={'rowIds':ids,'frames':frames,'profiles':{'soft':{'wav':{key:upstream_audio.audio_to_wav_bytes(data,44100) for key,data in stems.items()},
        'rowGain':1,'masterGain':gain,'metadata':metadata}}}
    wav,metrics=mix_row_stems(storage,profile='soft')
    return wav,metrics,storage,metadata
