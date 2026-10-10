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

UPSTREAM_SHA = '667d97c1e68de56fe2f5ef2d26784ee8a7308f3f'
VERSION = 'full-image-features-v2'
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

def build(image_bytes, options=None):
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
    rgb = np.clip(np.round(analysis['maps']['rgb'] * 255), 0, 255).astype(np.uint8)
    preview = io.BytesIO(); Image.fromarray(rgb).save(preview, format='PNG')
    payload = {'version': VERSION, 'upstream': UPSTREAM_SHA, 'info': dataclasses.asdict(info), 'features': analysis['features'],
        'settings': {'synth': synth, 'mapping': options.get('mapping','Scientific'), 'backing': options.get('backing',True), 'randomFactor': 0},
        'image': {'width': rgb.shape[1], 'height': rgb.shape[0], 'src': 'data:image/png;base64,' + base64.b64encode(preview.getvalue()).decode()},
        'variants': variants}
    return payload, waves
