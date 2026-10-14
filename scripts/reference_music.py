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
import arranger
import contextlib

# Refined reference layout: upper image rows sound higher, each with a register-suited soft voice.
OCTAVE_LAYOUT = {2: [0, -12], 3: [12, 0, -12], 4: [12, 0, -12, -24]}
SOFT_LAYOUT = {2: [0, 4], 3: [3, 0, 4], 4: [3, 0, 1, 4]}
OCTAVE_NAMES = {2: ['中音', '低音'], 3: ['高音', '中音', '低音'], 4: ['高音', '中音', '中低音', '低音']}

UPSTREAM_SHA = '667d97c1e68de56fe2f5ef2d26784ee8a7308f3f'
VERSION = 'full-image-features-v2'
PARALLEL_VERSION = 'horizontal-row-ensemble-v1'
WEIGHTS = np.array([.46, .20, .10, .12, .12])
FEATURE_NAMES = ['亮度', '色相', '饱和度', '对比度', '纹理']
CONTOUR_VERSION = 'feature-contour-v1'
PITCH_TRANSITION_VERSION = 'multi-feature-pitch-v1'

def feature_pitch_events(regions, allowed, voice_id, row, instrument, pan, transition):
    """Features set targets; scale snapping/glide sets how the targets are played.

    No image height, contour, centroid or region coordinates enter the pitch.
    """
    events=[]
    for region in regions:
        position=float(np.clip(sum(region['contributions'].values()),0,1))
        index=position*(len(allowed)-1)
        continuous=float(np.interp(index,np.arange(len(allowed)),allowed))
        midi=allowed[round(index)]
        region.update(pitchPosition=position,curveMidi=continuous,targetMidi=midi)
        if region['features']['brightness']<.012:
            region['reason']='暗区休止；不跨休止连接音高';continue
        record={'id':f'{voice_id}-note-{len(events)}','start':region['start'],
            'duration':region['end']-region['start'],'coverageEnd':region['end'],'midi':midi,
            'curveMidi':continuous,'pitchTransition':transition,
            'velocity':float(np.clip(.40+.18*region['features']['saturation']+.3*region['features']['contrast'],.3,.8)),
            'instrument':instrument,'pan':pan,'layer':'main','rowId':voice_id,'row':row,
            'sources':[{'regionId':region['id'],'rect':region['rect']}]}
        region.update(midi=midi,eventId=record['id'],
            reason='颜色、明暗、饱和度、对比度与纹理决定音高；'+('保留连续音高并平滑滑接' if transition=='glide' else '吸附到共用音阶并持续连奏'))
        events.append(record)
    return events

def contour_position(rgb, luminance):
    """One auditable height per column, not object recognition or line tracing.

    Color distance from the column background also detects dark/colored lines.
    Uniform columns have no height evidence, so their pitch uses local features.
    """
    background = np.median(rgb, axis=0, keepdims=True)
    distance = np.sqrt(np.mean((rgb-background)**2, axis=2))
    vertical_edge = np.zeros_like(luminance)
    if len(luminance) > 1:
        vertical_edge[1:] = np.abs(np.diff(luminance, axis=0))
    salience = distance + .22*vertical_edge
    confidence = float(np.clip(np.mean(salience)/.035, 0, 1))
    total = float(np.sum(salience))
    height = float(np.sum(salience*np.linspace(1,0,len(luminance))[:,None])/total) if total>1e-9 else .5
    return height, confidence

def contour_row_events(regions, rgb, luminance, allowed, voice_id, row, instrument, pan, transition):
    events = []
    for region in regions:
        rect = region['rect']; h,w=luminance.shape
        y0,y1=round(rect['y']*h),round((rect['y']+rect['height'])*h)
        x0,x1=round(rect['x']*w),round((rect['x']+rect['width'])*w)
        height,confidence=contour_position(rgb[y0:y1,x0:x1],luminance[y0:y1,x0:x1])
        feature_position=sum(region['contributions'].values())
        shape_weight=.62*confidence
        position=float(np.clip(shape_weight*height+(1-shape_weight)*feature_position,0,1))
        index=position*(len(allowed)-1)
        continuous=float(np.interp(index,np.arange(len(allowed)),allowed))
        midi=allowed[round(index)]
        region['features'].update(contourHeight=height,contourConfidence=confidence)
        region.update(contourWeight=shape_weight,curveMidi=continuous,targetMidi=midi,
            contourPoint={'x':rect['x']+rect['width']/2,'y':rect['y']+(1-height)*rect['height']})
        if region['features']['brightness']<.012 and confidence<.05:
            region['reason']='无明显结构的暗区休止；不跨休止连接';continue
        # No jump cap: a peak/valley is retained at its actual image time.
        record={'id':f'{voice_id}-note-{len(events)}','start':region['start'],
            'duration':region['end']-region['start'],'coverageEnd':region['end'],'midi':midi,
            'curveMidi':continuous,'pitchTransition':transition,'velocity':float(np.clip(.40+.18*region['features']['saturation']+.3*region['features']['contrast'],.3,.8)),
            'instrument':instrument,'pan':pan,'layer':'main','rowId':voice_id,'row':row,
            'sources':[{'regionId':region['id'],'rect':rect}]}
        reason='显著区域上移升音、下移降音；局部颜色、明暗与纹理共同修正，不压缩跳进'
        if confidence<.05:reason='本列无明显上下结构；由局部颜色、明暗与纹理决定音高'
        region.update(midi=midi,eventId=record['id'],reason=reason)
        events.append(record)
    return events

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

def full_feature_melody(analysis, info, options=None):
    options=options or {}
    method=options.get('featureMethod','features')
    if method not in ('features','contour','transition'):raise ValueError('全图映射设置无效')
    if method in ('contour','transition'):return full_mapped_melody(analysis,info,options.get('featurePitchTransition','glide'),method)
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

def full_mapped_melody(analysis, info, transition='glide', method='transition'):
    """The same pitch mapper as row playback, sequenced as one snake voice."""
    if transition not in ('scale','glide'):raise ValueError('全图音高转折设置无效')
    rgb,lum=analysis['maps']['rgb'],analysis['maps']['luminance']
    h,w=lum.shape;cols,rows=min(info.bars*2,w),min(4,h)
    slot=info.duration/(cols*rows)
    root=root_note(analysis['features'])
    allowed=upstream_composition.build_scale_notes(root,upstream_composition.SCALES[info.scale_name],root+10,root+31)
    regions=[]
    for col in range(cols):
        for row in (range(rows) if col%2==0 else reversed(range(rows))):
            x0,x1=round(col*w/cols),round((col+1)*w/cols)
            y0,y1=round(row*h/rows),round((row+1)*h/rows)
            features,vector=_local_features(rgb[y0:y1,x0:x1],lum[y0:y1,x0:x1])
            index=len(regions)
            regions.append({'id':f'cell-{index}','index':index,'col':col,'row':row,
                'rect':{'x':x0/w,'y':y0/h,'width':(x1-x0)/w,'height':(y1-y0)/h},
                'start':index*slot,'end':(index+1)*slot,'features':features,
                'contributions':dict(zip(FEATURE_NAMES,(vector*WEIGHTS).tolist())),
                'midi':None,'targetMidi':None,'eventId':None})
    if method=='contour':
        # Historical 0.5 experiment, retained for reproducing its API/test results.
        events=contour_row_events(regions,rgb,lum,allowed,'feature-main',0,info.main_instrument,0,transition)
    else:events=feature_pitch_events(regions,allowed,'feature-main',0,info.main_instrument,0,transition)
    for region in regions:
        region['reason']='全图蛇形单旋律；'+region['reason']
    return events,regions,cols,rows

def feature_pitch_metadata(options):
    method=options.get('featureMethod','transition')
    return {'featureMethod':method,'pitchVersion':PITCH_TRANSITION_VERSION if method=='transition' else CONTOUR_VERSION,
        'pitchTransition':options.get('featurePitchTransition','glide'),'voiceName':'暖键 · 连奏',
        'scanOrder':'column-snake','voiceCount':1}

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
    transition=options.get('pitchTransition','scale')
    if count not in (2, 3, 4) or method not in ('reference', 'reference-plus', 'features', 'contour', 'transition'): raise ValueError('行数或行内映射设置无效')
    if transition not in ('scale','glide'):raise ValueError('音高转折设置无效')
    rgb, lum = analysis['maps']['rgb'], analysis['maps']['luminance']
    h, w = lum.shape
    if h < count: raise ValueError('图片高度不足以分割成所选行数')
    cols = min(info.bars * (4 if method == 'features' else 8), w)
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
        if method=='transition':
            row_events=feature_pitch_events(row_regions,allowed,voice_id,row,instrument,pan,transition)
        elif method == 'contour':
            row_events=contour_row_events(row_regions,rgb,lum,allowed,voice_id,row,instrument,pan,transition)
        elif method in ('reference', 'reference-plus'):
            # The refined layout keeps every pitch class and contour, moving whole rows by octaves.
            offset = OCTAVE_LAYOUT[count][row] if method == 'reference-plus' else 0
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
                played = midi + offset
                while played < 31: played += 12
                record.update(id=f'{voice_id}-note-{len(row_events)}',midi=played,rowId=voice_id,row=row,
                    pan=float(np.clip(.55*event.pan+.45*pan,-.75,.75)),
                    sources=[{'regionId':region['id'],'rect':region['rect']}])
                if method == 'reference-plus': record['voicePreset'] = SOFT_LAYOUT[count][row]
                region.update(eventId=record['id'],midi=played,targetMidi=target+offset,
                    reason='行内参考条带法；统一到全图音阶与速度'+('；按图片上下分到不同八度' if offset else ''), originalMidi=event.midi)
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
        if method == 'reference-plus':
            voices[-1].update(fixedMidi=True, name=f'第 {row + 1} 行 · {OCTAVE_NAMES[count][row]}')
        events.extend(row_events)
    events.sort(key=lambda e:(e['start'],e['row'],e['midi']))
    return events,regions,cols,count,voices

def arranged_rows(analysis, info, options=None):
    """Rows keep their image regions; the arranger gives each row a musical role."""
    options = options or {}
    count = int(options.get('rowCount', 4))
    if count not in (2, 3, 4): raise ValueError('行数或行内映射设置无效')
    rgb, lum = analysis['maps']['rgb'], analysis['maps']['luminance']
    h, w = lum.shape
    if h < count: raise ValueError('图片高度不足以分割成所选行数')
    beat = 60 / info.tempo
    bars = max(1, int(info.duration / (4 * beat) + 1e-6))
    cols = min(bars * 4, w)
    bars = cols // 4; cols = bars * 4
    synth = options.get('synth', 'GeneralUser GS')
    rows, regions = [], []
    for row in range(count):
        y0, y1 = round(row * h / count), round((row + 1) * h / count)
        row_regions = []
        for col in range(cols):
            x0, x1 = round(col * w / cols), max(round(col * w / cols) + 1, round((col + 1) * w / cols))
            features, vector = _local_features(rgb[y0:y1, x0:x1], lum[y0:y1, x0:x1])
            region = {'id': f'parallel-{row}-{col}', 'index': len(regions), 'row': row, 'col': col, 'rowId': f'row-{row}',
                'rect': {'x': x0 / w, 'y': y0 / h, 'width': (x1 - x0) / w, 'height': (y1 - y0) / h},
                'start': col * beat, 'end': (col + 1) * beat, 'features': features,
                'contributions': dict(zip(FEATURE_NAMES, (vector * WEIGHTS).tolist())), 'targetMidi': None,
                'midi': None, 'eventId': None, 'reason': '暗区休止，或由前一个音延续'}
            row_regions.append(region); regions.append(region)
        rows.append(row_regions)
    parts, backing, meta = arranger.arrange(analysis['features'], info, root_note(analysis['features']), rows, synth)
    reasons = {'melody': '主旋律：本行特征在全图中的相对高低决定旋律走向，强拍落在和弦音上；纹理与对比决定节奏疏密',
        'counter': '副旋律：本行特征选择和弦内音，以长音衬在主旋律下方并避开碰撞',
        'arpeggio': '分解和弦：本行明暗决定音区，纹理与对比决定分解速度',
        'bass': '低音：每小节奏和弦根音，本行纹理与对比决定低音律动'}
    events, voices = [], []
    for row in range(count):
        part = parts[row]; role = part['role']; voice_id = f'row-{row}'
        y0, y1 = round(row * h / count), round((row + 1) * h / count)
        row_events = []
        for note in part['notes']:
            first, last = note.pop('cells')
            covered = rows[row][first:max(first + 1, min(last, cols))]
            record = dict(note, id=f'{voice_id}-note-{len(row_events)}', instrument=part['instrument'],
                pan=arranger.ROLE_PAN[role], layer='main', rowId=voice_id, row=row, role=role,
                coverageEnd=note['start'] + note['duration'],
                sources=[{'regionId': r['id'], 'rect': r['rect']} for r in covered])
            for region in covered:
                # The first note starting in a region owns it; held notes cover the rest.
                starts_here = region['start'] - 1e-7 <= record['start'] < region['end'] - 1e-7
                if (starts_here and not region.get('_owner')) or region['eventId'] is None:
                    region.update(eventId=record['id'], midi=record['midi'], targetMidi=record['midi'], reason=reasons[role])
                    if starts_here: region['_owner'] = True
            row_events.append(record)
        events.extend(row_events)
        voices.append({'id': voice_id, 'row': row, 'name': f'第 {row + 1} 行 · {arranger.ROLE_NAMES[role]}',
            'instrument': part['instrument'], 'instrumentName': upstream_composition.instrument_label(part['instrument']),
            'rect': {'x': 0, 'y': y0 / h, 'width': 1, 'height': (y1 - y0) / h}, 'noteCount': len(row_events),
            'role': role, 'gain': arranger.ROLE_GAIN[role]})
    for region in regions: region.pop('_owner', None)
    events.sort(key=lambda e: (e['start'], e['row'], e['midi']))
    backing.sort(key=lambda e: (e['start'], e['midi']))
    return events, regions, cols, count, voices, backing, meta

@contextlib.contextmanager
def arranged_midi(enabled=True):
    """Use the correct MIDI writer (with reverb send) only for the arranged combination."""
    if not enabled:
        yield; return
    original = upstream_audio.midi_bytes_from_events
    upstream_audio.midi_bytes_from_events = arranger.midi_bytes
    try: yield
    finally: upstream_audio.midi_bytes_from_events = original

def is_arranged(voices):
    return any(v.get('role') for v in voices)

def fixed_midi(voices):
    return any(v.get('role') or v.get('fixedMidi') for v in voices)

def backing_records(context):
    return context.get('backingEvents') or [e for e in context['reference'] if e['layer'] != 'main']

def render_backing(context):
    with arranged_midi(context.get('fixedMidi', False)):
        return render_score(backing_records(context), context['info'], context['synth'])[0]

def _level_gain(samples, target=.1):
    """Gain that brings the RMS of the sounding blocks (silence excluded) to the target."""
    block=2048;size=len(samples)//block*block
    if size==0:return 1.
    energy=np.mean(samples[:size].reshape(-1,block,2)**2,axis=(1,2))
    loud=energy[energy>max(float(np.max(energy))*1e-3,1e-10)]
    return float(min(8,target/math.sqrt(float(np.mean(loud))))) if len(loud) else 1.

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
    voice_gain=source.get('voiceGain',{})
    for key in ids:
        samples+=_pcm(source['wav'][key])*source['rowGain']*voice_gain.get(key,1)
    if include_background and 'background' in source['wav']: samples+=_pcm(source['wav']['background'])*source.get('backgroundGain',1)
    # Keep the full-mix gain when muting rows; a solo is not secretly boosted.
    samples-=np.mean(samples,axis=0)
    samples=soft_row_mixer.master(samples,source['masterGain']) if profile=='soft' else np.clip(samples*source['masterGain'],-.98,.98)
    wav=upstream_audio.audio_to_wav_bytes(samples,44100)
    return wav,audio_metrics(samples,44100)

def render_parallel(events, reference, info, synth, voices, backing=True, include_soft=True, background_wav=None):
    with arranged_midi(fixed_midi(voices)):
        return _render_parallel(events, reference, info, synth, voices, backing, include_soft, background_wav)

def _render_parallel(events, reference, info, synth, voices, backing, include_soft, background_wav):
    stems={};metadata={};row_ids=[v['id'] for v in voices]
    voice_gain={v['id']:float(v.get('gain',1)) for v in voices}
    background_gain=arranger.BACKING_GAIN if is_arranged(voices) else 1
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
    if is_arranged(voices):
        # Stems differ widely in raw level; align their audible loudness before role weights.
        for key in row_ids: voice_gain[key]*=_level_gain(_pcm(stems[key]))
        if 'background' in stems: background_gain*=_level_gain(_pcm(stems['background']))
    frames=len(_pcm(stems[row_ids[0]]));row_gain=.8/math.sqrt(len(row_ids))
    full=np.zeros((frames,2))
    for key in row_ids: full+=_pcm(stems[key])*row_gain*voice_gain[key]
    if 'background' in stems: full+=_pcm(stems['background'])*background_gain
    dc=np.mean(full,axis=0);full-=dc
    rms=float(np.sqrt(np.mean(full**2)));master_gain=min(1,.16/max(rms,1e-12))
    # Arranged stems are level-aligned, so a sparse score may be raised to the soft mix's loudness.
    if is_arranged(voices):master_gain=min(4,.085/max(rms,1e-12))
    bound=sum(float(np.max(np.abs(_pcm(stems[key]))))*row_gain*voice_gain[key] for key in row_ids)
    if 'background' in stems: bound+=float(np.max(np.abs(_pcm(stems['background']))))*background_gain
    master_gain=min(master_gain,.86/max(bound+1e-6,1e-12))
    storage={'wav':stems,'rowIds':row_ids,'frames':frames,'rowGain':row_gain,'masterGain':master_gain,'dc':dc.tolist()}
    if is_arranged(voices): storage.update(voiceGain=voice_gain,backgroundGain=background_gain)
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
    feature_main, feature_regions, cols, rows = full_feature_melody(analysis, info, options)
    feature = [row for row in reference if row['layer'] != 'main'] + feature_main
    feature.sort(key=lambda row: (row['start'], row['layer'], row['midi']))
    synth = options.get('synth', 'GeneralUser GS')
    variants, waves = {}, {}
    for variant, records, regions, width, height in [('reference', reference, reference_regions, info.bars * 8, 1), ('features', feature, feature_regions, cols, rows)]:
        audible = [row for row in records if options.get('backing', True) or row['layer'] == 'main']
        if variant=='features' and options.get('featureMethod') in ('contour','transition'):
            wav,metrics,message=render_feature_transition(audible,info,synth)
            samples=_pcm(wav)
        else:
            events = [NoteEvent(**{name: row[name] for name in ['start','duration','midi','velocity','instrument','pan','layer']}) for row in audible]
            samples, message = upstream_audio.render_backend(events, info, synth)
            if synth == 'GeneralUser GS' and 'through FluidSynth' not in message:
                raise RuntimeError('GeneralUser GS 音源未能启动；请先运行准备脚本，或明确选择原版 Simple 音源。')
            # Match upstream UI's final master normalization as well.
            samples = upstream_audio.normalize_master_audio(samples)
            wav = upstream_audio.audio_to_wav_bytes(samples, 44100)
            metrics=audio_metrics(samples,44100)
        waves[variant] = wav
        variants[variant] = {'events': audible, 'regions': regions, 'cols': width, 'rows': height,
            'mainCount': sum(row['layer'] == 'main' for row in audible), 'layerCounts': dict(Counter(row['layer'] for row in audible)),
            'duration': len(samples) / 44100, 'metrics': metrics, 'wavSha256': hashlib.sha256(wav).hexdigest(),
            'scoreSha256': hashlib.sha256(json.dumps(audible, sort_keys=True).encode()).hexdigest(), 'backend': message}
        if variant=='features' and options.get('featureMethod') in ('contour','transition'):variants[variant].update(feature_pitch_metadata(options))
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
        if options.get('rowMethod')=='contour':
            variants['parallel'].update(contourVersion=CONTOUR_VERSION,pitchTransition=options.get('pitchTransition','scale'))
        if options.get('rowMethod')=='transition':
            variants['parallel'].update(pitchVersion=PITCH_TRANSITION_VERSION,pitchTransition=options.get('pitchTransition','scale'))
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
    feature_main,feature_regions,cols,rows=full_feature_melody(analysis,info,options)
    feature=[r for r in reference if r['layer']!='main']+feature_main
    feature.sort(key=lambda e:(e['start'],e['layer'],e['midi']))
    arranged=options.get('rowMethod')=='arranged'
    if arranged:
        row_events,row_regions,row_cols,row_count,voices,backing_events,arrangement=arranged_rows(analysis,info,options)
    else:
        row_events,row_regions,row_cols,row_count,voices=horizontal_row_melodies(analysis,info,options)
        backing_events=[e for e in reference if e['layer']!='main']
    harmony=None
    if options.get('rowMethod')=='reference-plus':
        beat=60/info.tempo
        backing_events,harmony=arranger.harmonize(row_events,info,root_note(analysis['features']),max(1,int(info.duration/(4*beat)+1e-6)),options.get('synth','GeneralUser GS'))
    parallel=row_events+(backing_events if options.get('backing',True) else [])
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
            'voices':[soft_row_mixer.VOICES[soft_row_mixer.preset_index([e for e in row_events if e.get('rowId')==v['id']],i)]['name'] for i,v in enumerate(voices)]}})
    if options.get('rowMethod')=='contour':
        variants['parallel'].update(contourVersion=CONTOUR_VERSION,pitchTransition=options.get('pitchTransition','scale'))
    if options.get('rowMethod')=='transition':
        variants['parallel'].update(pitchVersion=PITCH_TRANSITION_VERSION,pitchTransition=options.get('pitchTransition','scale'))
    if arranged:variants['parallel'].update(arrangement=arrangement)
    if harmony:variants['parallel'].update(harmony=harmony)
    if options.get('featureMethod') in ('contour','transition'):variants['features'].update(feature_pitch_metadata(options))
    rgb=np.clip(np.round(analysis['maps']['rgb']*255),0,255).astype(np.uint8)
    preview=io.BytesIO();Image.fromarray(rgb).save(preview,format='PNG')
    payload={'version':VERSION,'upstream':UPSTREAM_SHA,'info':dataclasses.asdict(info),'features':analysis['features'],
        'settings':{'synth':options.get('synth','GeneralUser GS'),'mapping':options.get('mapping','Scientific'),
            'backing':options.get('backing',True),'randomFactor':0},
        'image':{'width':rgb.shape[1],'height':rgb.shape[0],'src':'data:image/png;base64,'+base64.b64encode(preview.getvalue()).decode()},
        'variants':variants}
    context={'info':info,'synth':options.get('synth','GeneralUser GS'),'rowEvents':row_events,'reference':reference,
        'voices':voices,'backing':options.get('backing',True)}
    if arranged or harmony:context.update(backingEvents=backing_events,fixedMidi=True)
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

def render_feature_transition(records, info, synth, background_wav=None):
    main=[e for e in records if e['layer']=='main']
    background=[e for e in records if e['layer']!='main']
    if background and background_wav is None:background_wav=render_score(background,info,synth)[0]
    context={'rowEvents':main,'voices':[{'id':'feature-main'}],'info':info}
    wav,metrics,_,_=render_soft_rows(context,background_wav if background else None)
    return wav,metrics,'Full-image multi-feature pitch, one continuous warm-key voice; shared reference backing.'
