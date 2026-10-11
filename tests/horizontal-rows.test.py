import dataclasses, itertools, json, pathlib, sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
import reference_music as m
import numpy as np
from PIL import Image

def analyze(pixels):
    return m.upstream_analysis.analyze_image(Image.fromarray(np.asarray(pixels,dtype=np.uint8)),random_factor=0)

pixels=np.zeros((120,192,3),dtype=np.uint8)
colors=[(230,155,70),(70,195,170),(145,100,210),(185,90,80)]
for row,color in enumerate(colors):
    for x in range(192):
        value=.25+.75*(x/191 if row%2==0 else 1-x/191)
        pixels[row*30:(row+1)*30,x]=np.array(color)*value
analysis=analyze(pixels)
_,info=m.original_composition(analysis,{'synth':'Simple','bars':8})
allowed=m.upstream_composition.build_scale_notes(m.root_note(analysis['features']),m.upstream_composition.SCALES[info.scale_name],m.root_note(analysis['features'])+10,m.root_note(analysis['features'])+31)
checks=[]
for rows in [2,3,4]:
    for method in ['reference','features']:
        options={'rowCount':rows,'rowMethod':method,'synth':'Simple'}
        events,regions,cols,count,voices=m.horizontal_row_melodies(analysis,info,options)
        assert count==rows and len(voices)==rows and len(regions)==rows*cols
        mask=np.zeros((120,192),dtype=int)
        for region in regions:
            q=region['rect'];x=round(q['x']*192);y=round(q['y']*120);w=round(q['width']*192);h=round(q['height']*120)
            mask[y:y+h,x:x+w]+=1
            assert abs(region['start']-region['col']*info.duration/cols)<1e-9
            assert region['rowId']==f'row-{region["row"]}'
        assert np.all(mask==1)
        for row in range(rows):
            track=[e for e in events if e['row']==row]
            assert track and track[0]['start']==0
            assert [e['start'] for e in track]==sorted(e['start'] for e in track)
            assert all(e['midi'] in allowed for e in track)
            assert all(abs(a['midi']-b['midi'])<=5 for a,b in zip(track,track[1:]))
            for event in track:
                assert event['instrument']==voices[row]['instrument']
                for ref in event['sources']:
                    source=next(r for r in regions if r['id']==ref['regionId'])
                    assert source['row']==row and source['midi']==event['midi']
        assert m.horizontal_row_melodies(analysis,info,options)==(events,regions,cols,count,voices)
checks.append('2/3/4 rows × two mapping methods: simultaneous start, horizontal time, shared scale, bounded jumps, exact pixel coverage and sources')
# A row is computed independently; freeze shared global constraints for this comparison.
changed=pixels.copy();changed[90:]=np.flip(changed[90:],axis=1)
other=analyze(changed);other['features']=analysis['features'].copy()
for method in ['reference','features']:
    before=m.horizontal_row_melodies(analysis,info,{'rowMethod':method,'synth':'Simple'})
    after=m.horizontal_row_melodies(other,info,{'rowMethod':method,'synth':'Simple'})
    for row in [0,1,2]:assert [e for e in before[0] if e['row']==row]==[e for e in after[0] if e['row']==row]
    assert [e for e in before[0] if e['row']==3]!=[e for e in after[0] if e['row']==3]
checks.append('bottom-row edit does not alter other rows at fixed global constraints')
for invalid in [1,5]:
    try:m.horizontal_row_melodies(analysis,info,{'rowCount':invalid});raise AssertionError('invalid row count accepted')
    except ValueError:pass
photo=(m.ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()
base,base_wavs=m.build(photo)
payload,waves,mixer=m.build_with_parallel(photo)
for variant in ['reference','features']:
    assert payload['variants'][variant]==base['variants'][variant]
    assert waves[variant]==base_wavs[variant]
p=payload['variants']['parallel']
assert p['rows']==4 and len(p['stems'])==5
assert all('through FluidSynth' in stem['backend'] for stem in p['stems'].values())
assert m.mix_row_stems(mixer)[0]==waves['parallel']
for bits in itertools.product([False,True],repeat=4):
    ids=[f'row-{i}' for i,enabled in enumerate(bits) if enabled]
    for background in [False,True]:
        wav,metrics=m.mix_row_stems(mixer,ids,background)
        assert metrics['invalid']==0 and metrics['clipped']==0 and metrics['peak']<=.86001
        if not ids and not background:assert metrics['peak']==0
checks.append('all 32 mute/background combinations: no clipping; full mix exactly reproducible; all-muted silence')
checks.append('real GS stems use independent renderers; reference and snake outputs unchanged byte for byte')
report={'status':'passed','checkedOn':'2026-10-11','checks':checks,'parallel':{'rows':p['rows'],'columns':p['cols'],'voices':[{k:v[k] for k in ['id','instrumentName','noteCount']} for v in p['voices']],'metrics':p['metrics']}}
(m.ROOT/'tests/horizontal-rows-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
