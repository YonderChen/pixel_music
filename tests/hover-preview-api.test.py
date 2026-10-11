import base64,io,json,os,pathlib,time,urllib.request,wave
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1]
URL=os.environ.get('DEMO_URL','http://127.0.0.1:4177')
image=base64.b64encode((ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()).decode()
def post(path,body):
    request=urllib.request.Request(URL+path,json.dumps(body).encode(),{'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=40) as r:return r.read()
def get(path):
    with urllib.request.urlopen(URL+path,timeout=40) as r:return r.read()
assert 'hover-note-atlas-v1' in json.loads(get('/api/health'))['capabilities']
cases=[]
for variant,method,profile in [('parallel','transition','original'),('parallel','reference','soft'),('parallel','features','soft'),('reference','reference','original')]:
    p=json.loads(post('/api/generate',{'image':image,'options':{'bars':4,'rowMethod':method,'featureMethod':'features','backing':False}}))
    body={'key':p['key'],'variant':variant,'profile':profile}
    began=time.perf_counter();meta=json.loads(post('/api/hover-bank',body));seconds=time.perf_counter()-began
    audio=get(meta['audioUrl']);assert json.loads(post('/api/hover-bank',body))==meta
    assert get(meta['audioUrl'])==audio
    with wave.open(io.BytesIO(audio),'rb') as r:
        assert r.getframerate()==44100 and r.getnchannels()==2
        samples=np.frombuffer(r.readframes(r.getnframes()),dtype='<i2')
    assert len(samples)==max(1,meta['toneCount'])*44100*2 and np.any(samples)
    assert set(meta['events'])=={e['id'] for e in p['variants'][variant]['events'] if e['layer']=='main' and e['instrument']!='none'}
    cases.append({'variant':variant,'method':method,'profile':profile,'toneCount':meta['toneCount'],'preparationSeconds':seconds,'bytes':len(audio)})
report={'status':'passed','checkedOn':'2026-10-11','checks':['four retained performances expose playable hover banks',
    'event lookup complete and offsets fit real stereo PCM','bank and audio responses reuse cached bytes'],'cases':cases}
(ROOT/'tests/hover-preview-api-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report))
