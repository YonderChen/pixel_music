"""The retained UI pairs must route scores, full playback and row mixes alike."""
import base64,hashlib,io,json,os,pathlib,time,urllib.request,wave
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parents[1]
URL=os.environ.get('DEMO_URL','http://127.0.0.1:4176')
image=base64.b64encode((ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()).decode()
def get(path):
    with urllib.request.urlopen(URL+path,timeout=40) as r:return r.read(),dict(r.headers)
def post(path,body):
    request=urllib.request.Request(URL+path,json.dumps(body).encode(),{'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=40) as r:return r.read(),dict(r.headers)
def pcm(wav):
    with wave.open(io.BytesIO(wav),'rb') as r:
        assert r.getnchannels()==2 and r.getframerate()==44100
        return np.frombuffer(r.readframes(r.getnframes()),dtype='<i2')

cases=[];reference_scores=[]
for recipe,method,profile in [('feature-original','transition','original'),('reference-soft','reference','soft'),('local-soft','features','soft')]:
    p=json.loads(post('/api/generate',{'image':image,'options':{'bars':4,'synth':'GeneralUser GS',
        'rowCount':4,'rowMethod':method,'pitchTransition':'scale','featureMethod':'features','backing':True}})[0])
    v=p['variants']['parallel'];assert v['rowMethod']==method
    reference_scores.append(p['variants']['reference']['events'])
    began=time.perf_counter();wav,headers=get(v['mixProfiles'][profile]['audioUrl']);seconds=time.perf_counter()-began
    assert np.any(pcm(wav)) and float(headers['X-Audio-Rms'])>0
    digest=hashlib.sha256(wav).hexdigest();assert digest==headers['X-Audio-Sha256']
    same,_=post('/api/rowmix',{'key':p['key'],'rows':['row-0','row-1','row-2','row-3'],'background':True,'profile':profile})
    assert same==wav
    mute,_=post('/api/rowmix',{'key':p['key'],'rows':[],'background':False,'profile':profile})
    assert not np.any(pcm(mute))
    preview,_=post('/api/preview',{'key':p['key'],'variant':'parallel','profile':profile,'eventId':v['events'][0]['id']})
    assert np.any(pcm(preview))
    cases.append({'recipe':recipe,'method':method,'profile':profile,'firstAudioSeconds':seconds,'wavSha256':digest})
assert reference_scores[0]==reference_scores[1]==reference_scores[2]
reference,_=get(p['variants']['reference']['audioUrl']);assert np.any(pcm(reference))
report={'status':'passed','checkedOn':'2026-10-11','checks':['three retained pairs use their correct score and audio profile',
    'full playback and row mixes reproduce identical WAV bytes','all-muted silence and region preview in every pair',
    'reference score identical across combinations and reference audio playable'],'cases':cases}
(ROOT/'tests/retained-combinations-api-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report))
