import dataclasses,hashlib,io,json,pathlib,sys,time,wave
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np
import reference_music as m
import reference_server as server
import hover_preview

photo=(m.ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()
cases=[]
for variant,method,profile in [('parallel','transition','original'),('parallel','reference','soft'),('parallel','features','soft'),('reference','reference','original')]:
    with patch.object(m.upstream_audio,'render_backend',side_effect=AssertionError('audio rendered on page open')):
        payload,context=m.prepare_scores(photo,{'bars':4,'rowMethod':method,'featureMethod':'features','backing':False})
    payload['key']='test';entry={'payload':payload,'context':context,'waves':{},'audioMetrics':{},'mixer':None,'background':None}
    before=json.dumps(payload,sort_keys=True);old_info=dataclasses.asdict(context['info'])
    calls=[];actual=m.upstream_audio.render_backend
    def spy(events,*args,**kwargs):
        calls.append({e.instrument for e in events});return actual(events,*args,**kwargs)
    began=time.perf_counter()
    with patch.object(m.upstream_audio,'render_backend',side_effect=spy):
        bank=server.ensure_hover_bank(entry,variant,profile)
        assert server.ensure_hover_bank(entry,variant,profile) is bank
    seconds=time.perf_counter()-began;meta=bank['metadata']
    v=payload['variants'][variant];events=[e for e in v['events'] if e['layer']=='main' and e['instrument']!='none']
    assert set(meta['events'])=={e['id'] for e in events}
    assert all(0<=binding['tone']<meta['toneCount'] and 0<=binding['gain']<=1.5 for binding in meta['events'].values())
    if profile=='original':
        assert len(calls)==len({e['instrument'] for e in events}) and all(len(group)==1 for group in calls)
    else:assert calls==[],'soft bank must not render unused GS audio'
    with wave.open(io.BytesIO(bank['wav']),'rb') as reader:
        assert reader.getnchannels()==2 and reader.getframerate()==44100
        audio=np.frombuffer(reader.readframes(reader.getnframes()),dtype='<i2').reshape(-1,2)/32767
    assert np.max(np.abs(audio))<=.551
    for tone in meta['tones']:
        start=round(tone['offset']*44100);end=start+round(tone['duration']*44100);piece=audio[start:end]
        assert np.max(np.abs(piece))>0 and np.max(np.abs(piece[0]))==np.max(np.abs(piece[-1]))==0,(variant,method,profile,tone,float(np.max(np.abs(piece))),piece[0],piece[-1])
    # Measure a real note, rather than trusting the tone index metadata.
    event=events[0];tone=meta['tones'][meta['events'][event['id']]['tone']]
    start=round((tone['offset']+.04)*44100);signal=audio[start:start+round(.24*44100)].sum(axis=1)
    spectrum=np.abs(np.fft.rfft(signal*np.hanning(len(signal))));frequencies=np.fft.rfftfreq(len(signal),1/44100)
    expected=440*2**((event['midi']-69)/12)
    fundamental=np.max(spectrum[np.abs(frequencies-expected)<7])
    assert fundamental>np.max(spectrum)*.07,(variant,profile,expected)
    assert json.dumps(payload,sort_keys=True)==before and dataclasses.asdict(context['info'])==old_info
    assert entry['waves']=={} and entry['background'] is None
    cases.append({'variant':variant,'method':method,'profile':profile,'toneCount':meta['toneCount'],
        'GSRenderCalls':len(calls),'preparationSeconds':seconds,'wavBytes':len(bank['wav']),'sha256':hashlib.sha256(bank['wav']).hexdigest()})
report={'status':'passed','checkedOn':'2026-10-11','checks':['four retained performances use their actual pitch and instrument vocabulary',
    'one GS render per instrument, no unused full-song or backing renders','cached bank reused without synthesis',
    'bounded stereo audio, smooth boundaries, measured fundamental','scores and composition settings unchanged'],'cases':cases}
(m.ROOT/'tests/hover-preview-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
