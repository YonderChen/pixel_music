"""Image turns must survive both the score and the audible pitch trajectory."""
import hashlib, io, json, pathlib, sys, time, types
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np
from PIL import Image
import reference_music as m
import soft_row_mixer as sound

checks=[]
pixels=np.full((160,256,3),24,dtype=np.uint8)
u=np.linspace(0,1,256)
heights=[u,1-u,1-np.abs(2*u-1),np.abs(2*u-1)]
for row,height in enumerate(heights):
    for x,value in enumerate(height):
        y=row*40+round(33-26*value)
        pixels[y-2:y+3,x]=[235,194,100]
encoded=io.BytesIO();Image.fromarray(pixels).save(encoded,format='PNG');image=encoded.getvalue()
analysis=m.upstream_analysis.analyze_image(Image.fromarray(pixels),random_factor=0)
_,info=m.original_composition(analysis,{'bars':4,'synth':'Simple'})
options={'bars':4,'synth':'Simple','rowMethod':'contour','pitchTransition':'glide','backing':False}
events,regions,cols,rows,voices=m.horizontal_row_melodies(analysis,info,options)
tracks=[[e for e in events if e['row']==row] for row in range(4)]
pitches=[np.array([e['curveMidi'] for e in track]) for track in tracks]
assert np.all(np.diff(pitches[0])>=-.015),pitches[0]
assert np.all(np.diff(pitches[1])<=.015),pitches[1]
assert abs(int(np.argmax(pitches[2]))-cols//2)<=1
assert abs(int(np.argmin(pitches[3]))-cols//2)<=1
assert all(np.ptp(p)>7 for p in pitches)
assert all(len(track)==cols for track in tracks)
checks.append('four real image rows retain rising, falling, peak and valley pitch contours')
# A genuine abrupt change must not be flattened by the old five-semitone cap.
sharp=pixels.copy()
for x in range(256):
    sharp[:40,x]=24;y=7 if x<128 else 33;sharp[y-2:y+3,x]=[235,194,100]
other=m.upstream_analysis.analyze_image(Image.fromarray(sharp),random_factor=0)
other['features']=analysis['features'].copy()
abrupt=m.horizontal_row_melodies(other,info,options)[0]
assert max(abs(a['midi']-b['midi']) for a,b in zip([e for e in abrupt if e['row']==0],[e for e in abrupt if e['row']==0][1:]))>5
checks.append('a large image turn survives without a fabricated staircase or jump cap')
# Equal-luminance colors and matched-mean texture still change actual pitch.
colors=np.zeros_like(pixels);colors[:,:128]=[84,0,0];colors[:,128:]=[0,0,247]
colored=m.upstream_analysis.analyze_image(Image.fromarray(colors),random_factor=0);colored['features']=analysis['features'].copy()
color_events,color_regions,*_=m.horizontal_row_melodies(colored,info,options)
for row in range(4):
    p=[e['curveMidi'] for e in color_events if e['row']==row]
    assert abs(p[0]-p[-1])>.5
assert all(r['features']['contourConfidence']<1e-9 for r in color_regions)
texture=np.full_like(pixels,128)
texture[:,128:]=np.where(((np.indices((160,128)).sum(axis=0)%2)==0)[...,None],64,192)
textured=m.upstream_analysis.analyze_image(Image.fromarray(texture),random_factor=0);textured['features']=analysis['features'].copy()
texture_events=m.horizontal_row_melodies(textured,info,options)[0]
assert abs(texture_events[0]['curveMidi']-next(e for e in texture_events if e['row']==0 and e['start']>info.duration*.8)['curveMidi'])>.5
checks.append('color-only and texture changes still affect audible pitch without a vertical outline')
mask=np.zeros((160,256),dtype=np.uint8)
for r in regions:
    q=r['rect'];x,y=round(q['x']*256),round(q['y']*160);w,h=round(q['width']*256),round(q['height']*160)
    mask[y:y+h,x:x+w]+=1
    e=next(e for e in events if e['id']==r['eventId'])
    assert e['sources'][0]['regionId']==r['id'] and e['row']==r['row']
assert np.all(mask==1)
for count in (2,3,4):
    row_events,row_regions,width,height,row_voices=m.horizontal_row_melodies(analysis,info,dict(options,rowCount=count))
    assert height==count and len(row_voices)==count and len(row_regions)==width*height
    assert all(abs(e['start']-next(r for r in row_regions if r['id']==e['sources'][0]['regionId'])['start'])<1e-9 for e in row_events)
unchanged=m.horizontal_row_melodies(other,info,options)[0]
for row in (1,2,3):
    assert [e for e in unchanged if e['row']==row]==[e for e in events if e['row']==row]
for gray in (0,128,255):
    a=m.upstream_analysis.analyze_image(Image.fromarray(np.full_like(pixels,gray)),random_factor=0)
    notes=m.horizontal_row_melodies(a,info,options)[0]
    if gray==0:assert notes==[]
    else:assert len(set(e['curveMidi'] for e in notes))==1
checks.append('2/3/4 row coverage and timing, independent rows, traceable sources, no coordinate melody on uniform inputs, black rests')

base={'start':0.,'duration':.4,'midi':60,'curveMidi':60.35,'velocity':.65,'pitchTransition':'glide'}
for row in range(4):
    one,_=sound.render_voice([dict(base,duration=1.2)],3*sound.SR,row,4)
    split,_=sound.render_voice([dict(base,start=i*.4) for i in range(3)],3*sound.SR,row,4)
    assert np.max(np.abs(one-split))<1e-10
    # FFT measures the actual unsnapped fundamental, not just score metadata.
    mono=split[round(.2*sound.SR):round(1.1*sound.SR)].sum(axis=1)
    spectrum=np.abs(np.fft.rfft(mono*np.hanning(len(mono))))
    hz=np.fft.rfftfreq(len(mono),1/sound.SR)[np.argmax(spectrum)]
    assert abs(hz-440*2**((60.35-69)/12))<1.3,(row,hz)
    assert np.max(np.abs(split[-1000:]))==0
turns=[dict(base,start=i*.4,midi=p,curveMidi=p+.35) for i,p in enumerate([60,76,60])]
audio,_=sound.render_voice(turns,2*sound.SR,0,4)
assert np.isfinite(audio).all()
# A pitch change cannot create a sudden phase/amplitude discontinuity.
for boundary in [round(.4*sound.SR),round(.8*sound.SR)]:
    neighbourhood=audio[boundary-300:boundary+300,0]
    differences=np.delete(np.abs(np.diff(neighbourhood)),299)
    assert abs(audio[boundary,0]-audio[boundary-1,0])<=2.5*np.quantile(differences,.95)
    assert abs(audio[boundary,0]-audio[boundary-1,0])<.01
frequency,end=sound.pitch_segment(800,200,round(.2*sound.SR),.4,'glide')
assert frequency[0]==200 and np.all(np.diff(frequency)>0) and end>760
fast,_=sound.pitch_segment(800,200,round(.2*sound.SR),.4,'scale')
assert fast[round(.02*sound.SR)]>799.9
gap=[base,dict(base,start=1.3,midi=72,curveMidi=72.35)]
joined,_=sound.render_voice(gap,3*sound.SR,0,4)
alone,_=sound.render_voice([dict(gap[1],start=0)],round(1.7*sound.SR),0,4)
assert np.max(np.abs(joined[round(1.3*sound.SR):]-alone))<1e-10
checks.append('actual fractional fundamental, phase and envelope continuity, distinct snap/glide, pitch history resets after rests')

began=time.perf_counter()
with patch.object(m.upstream_audio,'render_backend',side_effect=AssertionError('audio rendered on open')):
    prepared,context=m.prepare_scores(image,options)
score_seconds=time.perf_counter()-began
scale_payload,_=m.prepare_scores(image,dict(options,pitchTransition='scale'))
assert [e['midi'] for e in prepared['variants']['parallel']['events']]==[e['midi'] for e in scale_payload['variants']['parallel']['events']]
assert [e['sources'] for e in prepared['variants']['parallel']['events']]==[e['sources'] for e in scale_payload['variants']['parallel']['events']]
began=time.perf_counter();wav,metrics,storage,meta=m.render_soft_rows(context);audio_seconds=time.perf_counter()-began
assert metrics['invalid']==metrics['clipped']==0 and metrics['rms']>.02 and metrics['peak']<.9
assert m.mix_row_stems(storage,[],False,'soft')[1]['peak']==0
scale_wav=m.render_soft_rows(m.prepare_scores(image,dict(options,pitchTransition='scale'))[1])[0]
assert scale_wav!=wav
checks.append('score-only startup preserved, scale/glide share image targets, finite complete WAV, all-muted silence')
# Compare old mappings and legacy timbres against the checked-in pre-change code.
import subprocess
before=types.ModuleType('before');before.__file__=str(m.ROOT/'scripts/reference_music.py')
exec(subprocess.check_output(['git','show','HEAD:scripts/reference_music.py'],cwd=m.ROOT,text=True),before.__dict__)
for method in ('reference','features'):
    old_options=dict(options,rowMethod=method)
    assert before.horizontal_row_melodies(analysis,info,old_options)==m.horizontal_row_melodies(analysis,info,old_options)
    old,_=before.prepare_scores(image,old_options);new,_=m.prepare_scores(image,old_options)
    for key in ('reference','features','parallel'):assert old['variants'][key]['events']==new['variants'][key]['events']
old_sound=types.ModuleType('before_sound')
exec(subprocess.check_output(['git','show','HEAD:scripts/soft_row_mixer.py'],cwd=m.ROOT,text=True),old_sound.__dict__)
for row in range(4):
    old=old_sound.render_voice([dict(base,pitchTransition='struck')],sound.SR,row,4)[0]
    new=sound.render_voice([dict(base,pitchTransition='struck')],sound.SR,row,4)[0]
    assert np.array_equal(old,new)
pinned=json.loads((m.VENDOR/'UPSTREAM.json').read_text())
for name,digest in pinned['files'].items():assert hashlib.sha256((m.VENDOR/name).read_bytes()).hexdigest()==digest
checks.append('old row mappings, reference/snake events, legacy soft waveforms and pinned upstream are unchanged')
report={'status':'passed','checkedOn':'2026-10-11','subjectivelyApproved':False,'referenceSite':'https://playmusictheory.net/play',
    'checks':checks,'rows':rows,'columns':cols,'scorePreparationSeconds':score_seconds,'softAudioSeconds':audio_seconds,'metrics':metrics}
(m.ROOT/'tests/pitch-contour-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
output=pathlib.Path('/private/tmp/pixelmusic-pitch-contour');output.mkdir(exist_ok=True)
(output/'turns.png').write_bytes(image);(output/'glide.wav').write_bytes(wav);(output/'scale.wav').write_bytes(scale_wav)
print(json.dumps(report,ensure_ascii=False))
