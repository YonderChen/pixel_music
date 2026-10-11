"""Build a compact note atlas once; pointer movement never launches a renderer."""
import dataclasses
import math
import numpy as np

VERSION='hover-note-atlas-v1'
SR=44100
GATE=.3125
CLIP=1.0
STRIDE=1.5
LEAD=.0625
VELOCITY=.65

def build(engine, variant, info, synth, profile):
    soft=profile=='soft'
    records=[e for e in variant['events'] if e['layer']=='main' and e['instrument']!='none']
    key_of=lambda e:(int(e.get('row',0)),e['midi']) if soft else (e['instrument'],e['midi'])
    representatives={key_of(e):e for e in records}
    keys=sorted(representatives)
    # The current scale has a small bounded vocabulary; reject accidental growth.
    if len(keys)>128:raise ValueError('移动试听音色过多，请减少分行或更换图片。')
    frame_count=round(CLIP*SR)
    samples=np.zeros((max(1,len(keys))*frame_count,2),dtype=np.float64)
    pieces={}
    if soft:
        for key in keys:
            record=dict(representatives[key],duration=GATE,velocity=VELOCITY)
            pieces[key]=engine.soft_row_mixer.preview(record,variant['rows'])[:frame_count]
    else:
        # One MIDI render per instrument, rather than one FluidSynth launch per tile.
        instruments=sorted({key[0] for key in keys})
        for instrument in instruments:
            group=[key for key in keys if key[0]==instrument]
            # Keep every MIDI delta below 128 ticks: the pinned upstream VLQ
            # writer only encodes one-byte deltas correctly. This independent
            # audition atlas does not change the original score/export path.
            notes=[engine.NoteEvent(i*STRIDE+LEAD,GATE,key[1],VELOCITY,instrument,0,'main') for i,key in enumerate(group)]
            bank_info=dataclasses.replace(info,duration=len(group)*STRIDE,tempo=8)
            rendered,message=engine.upstream_audio.render_backend(notes,bank_info,synth)
            if synth=='GeneralUser GS' and 'through FluidSynth' not in message:raise RuntimeError('移动试听 GS 音源未能启动')
            for i,key in enumerate(group):
                start=round((i*STRIDE+LEAD)*SR)
                pieces[key]=rendered[start:start+frame_count].copy()
    for i,key in enumerate(keys):
        piece=engine.upstream_audio.normalize_master_audio(pieces[key],target_peak=.55,target_rms=.12)
        # Cached clips end smoothly; the client fades the previous clip on movement.
        attack=round(.003*SR);release=round(.025*SR)
        piece[:attack]*=np.linspace(0,1,attack)[:,None]
        piece[-release:]*=np.linspace(1,0,release)[:,None]
        samples[i*frame_count:(i+1)*frame_count]=piece
    lookup={key:i for i,key in enumerate(keys)}
    events={}
    for e in records:
        ratio=float(np.clip(e['velocity']/VELOCITY,0,1.5))
        events[e['id']]={'tone':lookup[key_of(e)],'gain':math.sqrt(ratio) if soft else ratio}
    metadata={'version':VERSION,'profile':profile,'toneCount':len(keys),'gateSeconds':GATE,
        'tones':[{'offset':i*frame_count/SR,'duration':frame_count/SR} for i in range(len(keys))],'events':events}
    return engine.upstream_audio.audio_to_wav_bytes(samples,SR),metadata
