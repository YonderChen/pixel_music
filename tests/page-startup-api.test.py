import base64, concurrent.futures, hashlib, io, json, pathlib, time, urllib.request, wave
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:4177'
def request(path,data=None):
    encoded=None if data is None else json.dumps(data).encode()
    with urllib.request.urlopen(urllib.request.Request(BASE+path,data=encoded,headers={'Content-Type':'application/json'}),timeout=40) as response:
        return response.read(),dict(response.headers)
image=base64.b64encode((ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()).decode()
body={'image':image,'options':{'synth':'Simple','bars':4}}
started=time.perf_counter();data,_=request('/api/generate',body);score_seconds=time.perf_counter()-started
p=json.loads(data);key=p['key'];v=p['variants']['parallel']
assert score_seconds<4
assert all('metrics' not in variant for variant in p['variants'].values())
started=time.perf_counter();soft,headers=request(v['mixProfiles']['soft']['audioUrl']);soft_seconds=time.perf_counter()-started
assert float(headers['X-Audio-Rms'])>0
assert headers['X-Audio-Sha256']==hashlib.sha256(soft).hexdigest()
with wave.open(io.BytesIO(soft),'rb') as reader:
    assert reader.getnchannels()==2 and reader.getframerate()==44100
full,_=request('/api/rowmix',{'key':key,'profile':'soft','rows':['row-0','row-1','row-2','row-3'],'background':True})
assert full==soft
with concurrent.futures.ThreadPoolExecutor(1) as pool:
    original=pool.submit(request,v['audioUrl'])
    time.sleep(.05)
    started=time.perf_counter();request('/api/health');health_seconds=time.perf_counter()-started
    started=time.perf_counter();request('/feature-music.html');page_seconds=time.perf_counter()-started
    started=time.perf_counter();request('/api/generate',body);cached_score_seconds=time.perf_counter()-started
    assert max(health_seconds,page_seconds,cached_score_seconds)<.75
    raw,raw_headers=original.result()
assert raw!=soft and float(raw_headers['X-Audio-Rms'])>0
for profile in ['soft','original']:
    silent,_=request('/api/rowmix',{'key':key,'profile':profile,'rows':[],'background':False})
    assert all(x==0 for x in silent[44:])
report={'status':'passed','checkedOn':'2026-10-11','scoreSeconds':score_seconds,'firstSoftSeconds':soft_seconds,
    'duringOriginalRender':{'healthSeconds':health_seconds,'pageSeconds':page_seconds,'cachedScoreSeconds':cached_score_seconds},
    'checks':['HTTP page opening responds before audio rendering','actual WAV RMS and SHA headers support comparisons',
        'current soft full mix export reproducible','static files and cached scores respond during original rendering','both styles preserve all-muted silence']}
(ROOT/'tests/page-startup-api-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
