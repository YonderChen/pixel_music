import base64,hashlib,io,json,os,pathlib,time,urllib.request,wave
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1]
URL=os.environ.get('DEMO_URL','http://127.0.0.1:4177')
image=base64.b64encode((ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()).decode()
def get(path):
    with urllib.request.urlopen(URL+path,timeout=30) as r:return r.read(),dict(r.headers)
def post(path,body):
    req=urllib.request.Request(URL+path,json.dumps(body).encode(),{'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as r:return r.read(),dict(r.headers)
def pcm(data):
    with wave.open(io.BytesIO(data),'rb') as r:
        assert r.getnchannels()==2 and r.getframerate()==44100
        return np.frombuffer(r.readframes(r.getnframes()),dtype='<i2')
assert 'multi-feature-pitch-v1' in json.loads(get('/api/health')[0])['capabilities']
cases=[];scores=[];wavs=[]
for method,transition in [('transition','glide'),('transition','scale'),('features','glide')]:
    began=time.perf_counter()
    p=json.loads(post('/api/generate',{'image':image,'options':{'bars':4,'featureMethod':method,'featurePitchTransition':transition,'rowMethod':'transition','pitchTransition':transition,'backing':False}})[0])
    score_seconds=time.perf_counter()-began;v=p['variants']['features']
    assert 'metrics' not in v
    if method=='transition':assert v['featureMethod']=='transition' and v['pitchTransition']==transition and v['voiceCount']==1
    parallel=p['variants']['parallel']
    assert parallel['rowMethod']=='transition' and parallel['pitchTransition']==transition
    assert all('contourHeight' not in r['features'] and 'contourPoint' not in r for r in parallel['regions'])
    began=time.perf_counter();wav,headers=get(v['audioUrl']);audio_seconds=time.perf_counter()-began
    assert headers['X-Audio-Sha256']==hashlib.sha256(wav).hexdigest()
    assert float(headers['X-Audio-Rms'])>0 and np.any(pcm(wav))
    assert get(v['audioUrl'])[0]==wav
    preview,_=post('/api/preview',{'key':p['key'],'variant':'features','eventId':next(e for e in v['events'] if e['layer']=='main')['id']})
    assert np.any(pcm(preview))
    row_audio,_=get(parallel['mixProfiles']['soft']['audioUrl']);assert np.any(pcm(row_audio))
    scores.append(v['events']);wavs.append(wav)
    cases.append({'method':method,'transition':transition,'scoreSeconds':score_seconds,'audioSeconds':audio_seconds})
assert [e['midi'] for e in scores[0]]==[e['midi'] for e in scores[1]]
assert scores[0]!=scores[2] and len({hashlib.sha256(w).hexdigest() for w in wavs})==3
report={'status':'passed','checkedOn':'2026-10-11','checks':['full-image transition/scale/legacy options reach the actual server',
    'no on-open audio render metadata','real stereo WAVs differ between all three performances','SHA/RMS headers and cached byte equality',
    'region preview uses the selected full-image performance','parallel mapping also generates real sound without contour metadata'],'cases':cases}
(ROOT/'tests/full-pitch-transition-api-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report))
