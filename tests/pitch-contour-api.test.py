import base64, hashlib, io, json, os, pathlib, time, urllib.request, wave
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parents[1]
URL=os.environ.get('DEMO_URL','http://127.0.0.1:4177')
image=base64.b64encode(pathlib.Path('/private/tmp/pixelmusic-pitch-contour/turns.png').read_bytes()).decode()
def get(path):
    with urllib.request.urlopen(URL+path,timeout=30) as response:return response.read(),dict(response.headers)
def post(path,body):
    request=urllib.request.Request(URL+path,json.dumps(body).encode(),{'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=30) as response:return response.read(),dict(response.headers)
def pcm(wav):
    with wave.open(io.BytesIO(wav),'rb') as reader:
        assert reader.getframerate()==44100 and reader.getnchannels()==2
        return np.frombuffer(reader.readframes(reader.getnframes()),dtype='<i2')
assert 'feature-contour-v1' in json.loads(get('/api/health')[0])['capabilities']
generated=[]
for transition in ('scale','glide'):
    began=time.perf_counter()
    p=json.loads(post('/api/generate',{'image':image,'options':{'bars':4,'rowMethod':'contour','pitchTransition':transition,'backing':False}})[0])
    score_seconds=time.perf_counter()-began
    parallel=p['variants']['parallel']
    assert parallel['pitchTransition']==transition and parallel['rows']==4
    assert 'metrics' not in parallel['mixProfiles']['soft']
    began=time.perf_counter();wav,headers=get(parallel['mixProfiles']['soft']['audioUrl']);audio_seconds=time.perf_counter()-began
    assert headers['X-Audio-Sha256']==hashlib.sha256(wav).hexdigest()
    assert float(headers['X-Audio-Rms'])>.02
    assert len(pcm(wav))>44100*10
    same,_=post('/api/rowmix',{'key':p['key'],'rows':['row-0','row-1','row-2','row-3'],'background':False,'profile':'soft'})
    assert same==wav
    solo,_=post('/api/rowmix',{'key':p['key'],'rows':['row-0'],'background':False,'profile':'soft'})
    assert solo!=wav and np.any(pcm(solo))
    mute,_=post('/api/rowmix',{'key':p['key'],'rows':[],'background':False,'profile':'soft'})
    assert not np.any(pcm(mute))
    preview,_=post('/api/preview',{'key':p['key'],'variant':'parallel','profile':'soft','eventId':parallel['events'][0]['id']})
    assert np.any(pcm(preview))
    generated.append((p,wav,{'transition':transition,'scoreSeconds':score_seconds,'audioSeconds':audio_seconds}))
assert generated[0][1]!=generated[1][1]
assert [e['midi'] for e in generated[0][0]['variants']['parallel']['events']]==[e['midi'] for e in generated[1][0]['variants']['parallel']['events']]
report={'status':'passed','checkedOn':'2026-10-11','cases':[g[2] for g in generated],
    'checks':['score-only HTTP generation','scale and glide produce distinct real WAVs with common quantized targets',
        'RMS and SHA response headers','full mix byte reproducibility','solo, all-muted and region preview use chosen soft performance']}
(ROOT/'tests/pitch-contour-api-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report))
