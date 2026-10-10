import dataclasses
import hashlib
import io
import json
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
import reference_music as m
import numpy as np
from PIL import Image

def analysis(rgb):
    return m.upstream_analysis.analyze_image(Image.fromarray(np.clip(np.round(rgb*255),0,255).astype(np.uint8)),random_factor=0)

base=analysis(np.full((120,192,3),.4))
_, info=m.original_composition(base,{'synth':'Simple','bars':8})

def fixed_global(rgb):
    result=analysis(rgb);result['features']=base['features'].copy();return result

def melody(result):
    events,regions,cols,rows=m.full_feature_melody(result,info)
    assert len(regions)==64 and cols==16 and rows==4
    assert abs(sum(r['rect']['width']*r['rect']['height'] for r in regions)-1)<1e-9
    mask=np.zeros(result['maps']['luminance'].shape,dtype=int)
    h,w=mask.shape
    for r in regions:
        q=r['rect'];x=round(q['x']*w);y=round(q['y']*h);ww=round(q['width']*w);hh=round(q['height']*h)
        mask[y:y+hh,x:x+ww]+=1
        assert set(m.FEATURE_NAMES)==set(r['contributions'])
        if r['eventId']:
            e=next(e for e in events if e['id']==r['eventId']);assert e['midi']==r['midi']
            assert any(ref['regionId']==r['id'] for ref in e['sources'])
    assert np.all(mask==1), 'all normalized pixels are covered exactly once'
    allowed=m.upstream_composition.build_scale_notes(m.root_note(result['features']),m.upstream_composition.SCALES[info.scale_name],m.root_note(result['features'])+10,m.root_note(result['features'])+31)
    for e in events:
        assert e['midi'] in allowed and e['duration']>0 and e['start']<info.duration
    active=[r for r in regions if r['midi'] is not None]
    assert all(abs(b['midi']-a['midi'])<=5 for a,b in zip(active,active[1:])), 'bounded melodic jumps'
    assert m.full_feature_melody(result,info)==(events,regions,cols,rows), 'repeatable melody and sources'
    return [r['midi'] for r in regions],regions,events

checks=[]
# Uniform vs horizontal grayscale: changing only brightness changes pitches.
uniform=np.full((120,192,3),.4)
rgb=uniform.copy();rgb[:,96:]=.8
a=melody(fixed_global(uniform))[0];b=melody(fixed_global(rgb))[0];assert a!=b;checks.append('horizontal brightness changes pitch')
# Approximate equal-luminance saturated hues, uniform vertically: COM is unchanged.
hues=np.empty_like(uniform)
for i,color in enumerate([(84/255,0,0),(0,25/255,0),(0,0,247/255)]):hues[:,i*64:(i+1)*64]=color
hue_analysis=fixed_global(hues);hue_pitches,regions,events=melody(hue_analysis)
assert len(set(hue_pitches))>=3
assert max(r['features']['brightness'] for r in regions)-min(r['features']['brightness'] for r in regions)<.001
checks.append('equal luminance + unchanged vertical COM + horizontal hue changes pitch')
# Saturation changes at fixed hue and approximate fixed luminance.
sat=np.empty_like(uniform)
for col in range(192):
    s=.2 if col<96 else .9
    value=.16/(.2126+.7874*(1-s))
    sat[:,col]=[value,value*(1-s),value*(1-s)]
pitches,regions,_=melody(fixed_global(sat));assert len(set(pitches))>1
checks.append('saturation changes pitch without changing global mapping')
# Horizontal texture and contrast with fixed mean brightness.
texture=uniform.copy()
for y in range(120):
    for x in range(96,192): texture[y,x]=.4+(.18 if (x//2+y//2)%2 else -.18)
assert melody(fixed_global(texture))[0]!=a
checks.append('local contrast and frequency/entropy texture change pitch')
# Vertical changes are not averaged away by a full-height strip.
vertical=uniform.copy();vertical[:60]=.8;vertical[60:]=.15
pitches,regions,_=melody(fixed_global(vertical));assert len(set(pitches))>1
checks.append('vertical details retain their own cell and pitch')
# Stable and dark images do not acquire coordinate-generated pitch patterns.
assert len(melody(fixed_global(uniform))[2])==1
black=fixed_global(np.zeros_like(uniform));assert melody(black)[2]==[]
checks.append('uniform merges without fake contour / dark cells rest')
# Broad shape and colour inputs, not just the acceptance examples.
rng=np.random.default_rng(54)
for index in range(20):
    small=rng.random((10,16,3))
    rgb=np.repeat(np.repeat(small,12,axis=0),12,axis=1)
    melody(fixed_global(rgb))
checks.append('20 independent spatial colour fixtures')
manifest=json.loads((m.VENDOR/'UPSTREAM.json').read_text())
for name,digest in manifest['files'].items():assert hashlib.sha256((m.VENDOR/name).read_bytes()).hexdigest()==digest
photo=(m.ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()
original_analysis=m.upstream_analysis.analyze_image(m.upstream_analysis.open_image_from_bytes(photo),random_factor=0)
raw,raw_info=m.original_composition(original_analysis)
serialized,regions=m.serialize_reference(raw,original_analysis,raw_info)
fields=['start','duration','midi','velocity','instrument','pan','layer']
assert [dataclasses.asdict(e) for e in raw]==[{field:r[field] for field in fields} for r in serialized]
payload,waves=m.build(photo)
assert payload['settings']['synth']=='GeneralUser GS'
assert payload['variants']['reference']['backend'].startswith('Audio rendered with GeneralUser GS through FluidSynth')
assert {field:payload['info'][field] for field in dataclasses.asdict(raw_info)}==dataclasses.asdict(raw_info)
for mode,value in payload['variants'].items():
    assert value['metrics']['invalid']==0 and value['metrics']['clipped']==0
    assert value['metrics']['peak']<.98 and value['metrics']['rms']>0
    assert waves[mode][:4]==b'RIFF'
reference_nonmain=[{field:r[field] for field in fields} for r in payload['variants']['reference']['events'] if r['layer']!='main']
feature_nonmain=[{field:r[field] for field in fields} for r in payload['variants']['features']['events'] if r['layer']!='main']
assert reference_nonmain==feature_nonmain, 'same original accompaniment, texture and saliency solo'
checks.append('unchanged upstream source / exact original event fields / real GS render / same non-main events')
report={'status':'passed','checkedOn':'2026-10-10','upstream':m.UPSTREAM_SHA,'checks':checks,'photo':payload['info'],'audio':{k:v['metrics'] for k,v in payload['variants'].items()}}
(m.ROOT/'tests/reference-features-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
