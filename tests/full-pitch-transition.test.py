"""The new pitch conversion must also drive the real single-voice full-image score."""
import hashlib, io, json, pathlib, sys, time
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np
from PIL import Image
import reference_music as m
import reference_server as server

def encoded(pixels):
    output=io.BytesIO();Image.fromarray(pixels).save(output,format='PNG');return output.getvalue()
def analyze(pixels):return m.upstream_analysis.analyze_image(Image.fromarray(pixels),random_factor=0)
pixels=np.full((160,256,3),24,dtype=np.uint8)
u=np.linspace(0,1,256)
for row,heights in enumerate([u,1-u,1-np.abs(2*u-1),np.abs(2*u-1)]):
    for x,height in enumerate(heights):
        y=row*40+round(33-26*height);pixels[y-2:y+3,x]=[235,194,100]
analysis=analyze(pixels);_,info=m.original_composition(analysis,{'bars':4,'synth':'Simple'})
options={'bars':4,'synth':'Simple','featureMethod':'transition','featurePitchTransition':'glide','backing':False,'rowMethod':'transition'}
main,regions,cols,rows=m.full_feature_melody(analysis,info,options)
checks=[]
assert len(regions)==cols*rows and len(main)==len(regions)
assert [(r['col'],r['row']) for r in regions[:8]]==[(0,0),(0,1),(0,2),(0,3),(1,3),(1,2),(1,1),(1,0)]
assert len({e['rowId'] for e in main})==1 and all(e['row']==0 for e in main)
assert all(abs(a['start']+a['duration']-b['start'])<1e-9 for a,b in zip(main,main[1:]))
coverage=np.zeros((160,256),dtype=np.uint8)
for r in regions:
    q=r['rect'];x,y=round(q['x']*256),round(q['y']*160);w,h=round(q['width']*256),round(q['height']*160)
    coverage[y:y+h,x:x+w]+=1
    e=next(e for e in main if e['id']==r['eventId'])
    assert e['sources']==[{'regionId':r['id'],'rect':q}] and e['start']==r['start']
assert np.all(coverage==1)
row_pitch=[[r['curveMidi'] for r in sorted(regions,key=lambda r:r['col']) if r['row']==row] for row in range(4)]
assert all('contourHeight' not in r['features'] and 'contourPoint' not in r for r in regions)
# Coordinates are provenance, never a pitch input. Move the same feature record.
shifted=[dict(regions[0],rect={'x':.75,'y':.75,'width':.1,'height':.1},row=3)]
notes=m.feature_pitch_events(shifted,m.upstream_composition.build_scale_notes(m.root_note(analysis['features']),m.upstream_composition.SCALES[info.scale_name],m.root_note(analysis['features'])+10,m.root_note(analysis['features'])+31),'test',0,info.main_instrument,0,'glide')
assert notes[0]['curveMidi']==main[0]['curveMidi'] and notes[0]['midi']==main[0]['midi']
checks.append('one non-overlapping snake voice, complete pixel coverage, traceable sources, pitch independent of contour and coordinates')
for name,image in [('color',np.zeros_like(pixels)),('texture',np.full_like(pixels,128))]:
    if name=='color':image[:,:128]=[84,0,0];image[:,128:]=[0,0,247]
    else:image[:,128:]=np.where((np.indices((160,128)).sum(axis=0)%2==0)[...,None],64,192)
    a=analyze(image);a['features']=analysis['features'].copy()
    e,r,*_=m.full_feature_melody(a,info,options)
    left=np.mean([q['curveMidi'] for q in r if q['col']==0]);right=np.mean([q['curveMidi'] for q in r if q['col']==cols-1])
    assert abs(left-right)>.5,(name,left,right)
for gray in (0,128,255):
    e,r,*_=m.full_feature_melody(analyze(np.full_like(pixels,gray)),info,options)
    assert all('contourConfidence' not in region['features'] for region in r)
    if gray==0:assert not e
    else:assert len({event['curveMidi'] for event in e})==1
checks.append('equal-brightness colors and texture affect pitch; uniform inputs do not fabricate a coordinate melody; black rests')
assert m.full_feature_melody(analysis,info)==m.full_feature_melody(analysis,info,{'featureMethod':'features'})
image=encoded(pixels)
old,_=m.prepare_scores(image,dict(options,featureMethod='features'))
began=time.perf_counter()
with patch.object(m.upstream_audio,'render_backend',side_effect=AssertionError('audio rendered on page open')), patch.object(m,'contour_position',side_effect=AssertionError('contour used for new pitch conversion')):
    prepared,context=m.prepare_scores(image,options)
score_seconds=time.perf_counter()-began
v=prepared['variants']['features']
assert v['featureMethod']=='transition' and v['pitchTransition']=='glide' and v['voiceCount']==1
assert v['events']!=old['variants']['features']['events']
assert prepared['variants']['reference']['events']==old['variants']['reference']['events']
assert prepared['variants']['parallel']['events']==old['variants']['parallel']['events']
entry={'payload':prepared,'context':context,'waves':{},'audioMetrics':{},'mixer':None,'background':None}
with patch.object(m.upstream_audio,'render_backend',side_effect=AssertionError('unselected row/reference audio rendered')):
    began=time.perf_counter();glide,metrics=server.ensure_audio(entry,'features');audio_seconds=time.perf_counter()-began
assert set(entry['waves'])=={'features'}
assert metrics['invalid']==metrics['clipped']==0 and .02<metrics['rms']<.2
assert server.ensure_audio(entry,'features')[0] is glide
clear,_=m.prepare_scores(image,dict(options,featurePitchTransition='scale'))
assert [e['midi'] for e in clear['variants']['features']['events']]==[e['midi'] for e in v['events']]
assert m.render_feature_transition(clear['variants']['features']['events'],context['info'],'Simple')[0]!=glide
checks.append('new default option changes the actual feature score, scale/glide share targets but produce different WAVs; lazy rendering only prepares the selected voice')

eager,waves,_=m.build_with_parallel(image,options)
assert waves['features']==glide and eager['variants']['features']['events']==v['events']
# The accompaniment is shared between full-image and row playback, once only.
back_options=dict(options,backing=True)
back_payload,back_context=m.prepare_scores(image,back_options)
back_entry={'payload':back_payload,'context':back_context,'waves':{},'audioMetrics':{},'mixer':None,'background':None}
actual=m.upstream_audio.render_backend;calls=[]
def spy(events,*args,**kwargs):calls.append([e.layer for e in events]);return actual(events,*args,**kwargs)
with patch.object(m.upstream_audio,'render_backend',side_effect=spy):
    backed,back_metrics=server.ensure_audio(back_entry,'features')
    server.ensure_audio(back_entry,'parallel-soft')
assert len(calls)==1 and all(layer!='main' for layer in calls[0])
assert back_metrics['invalid']==back_metrics['clipped']==0
assert set(back_entry['waves'])=={'features','parallel-soft'}
silent,_=m.prepare_scores(encoded(np.zeros_like(pixels)),options)
silence=m.render_feature_transition(silent['variants']['features']['events'],context['info'],'Simple')[0]
assert np.max(np.abs(m._pcm(silence)))==0
checks.append('lazy/eager feature WAV equality, real backing shared once with parallel playback, complete black-image silence')
report={'status':'passed','checkedOn':'2026-10-11','subjectivelyApproved':False,'checks':checks,
    'scorePreparationSeconds':score_seconds,'firstFeatureAudioSeconds':audio_seconds,'regions':len(regions),'voices':1,'metrics':metrics}
(m.ROOT/'tests/full-pitch-transition-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
output=pathlib.Path('/private/tmp/pixelmusic-feature-pitch');output.mkdir(exist_ok=True)
(output/'turns.png').write_bytes(image);(output/'glide.wav').write_bytes(glide)
print(json.dumps(report,ensure_ascii=False))
