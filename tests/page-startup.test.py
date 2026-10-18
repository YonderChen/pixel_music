import hashlib, json, pathlib, sys, threading, time
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
import reference_music as engine
import reference_server as server
import numpy as np

photo=(engine.ROOT/'dist/sonification-assets/mars-sunset.png').read_bytes()
options={'bars':4,'synth':'Simple'}
began=time.perf_counter()
with patch.object(engine.upstream_audio,'render_backend',side_effect=AssertionError('page opening rendered audio')):
    prepared,context=engine.prepare_scores(photo,options)
seconds=time.perf_counter()-began
assert seconds<4,seconds
assert all(v['audioStatus']=='on-demand' for v in prepared['variants'].values())
entry={'payload':prepared,'context':context,'waves':{},'audioMetrics':{},'mixer':None,'background':None}
calls=[]
actual=engine.upstream_audio.render_backend
def spy(*args,**kwargs):
    calls.append(len(args[0]));return actual(*args,**kwargs)
with patch.object(engine.upstream_audio,'render_backend',side_effect=spy):
    began=time.perf_counter();soft,soft_metrics=server.ensure_audio(entry,'parallel-soft');soft_seconds=time.perf_counter()-began
assert len(calls)==1,'soft playback should render only the shared backing'
assert set(entry['waves'])=={'parallel-soft'}
assert server.ensure_audio(entry,'parallel-soft')[0] is soft
assert all(k not in entry['waves'] for k in ['reference','features','parallel'])

# A busy renderer must not hold the global cache lock and block page requests.
entered,released=threading.Event(),threading.Event()
def blocked(*args,**kwargs):
    entered.set();assert released.wait(5);return actual(*args,**kwargs)
result=[]
with patch.object(engine.upstream_audio,'render_backend',side_effect=blocked):
    worker=threading.Thread(target=lambda:result.append(server.ensure_audio(entry,'reference')))
    worker.start();assert entered.wait(5)
    assert server.LOCK.acquire(timeout=.1),'audio rendering held the page/cache lock'
    server.LOCK.release();released.set();worker.join(30);assert not worker.is_alive()

baseline,waves,_=engine.build_with_parallel(photo,options)
for variant in ['reference','features','parallel','parallel-soft']:
    wav,metrics=server.ensure_audio(entry,variant)
    assert wav==waves[variant],variant
    assert metrics['invalid']==metrics['clipped']==0
for variant in ['reference','features','parallel']:
    assert prepared['variants'][variant]['events']==baseline['variants'][variant]['events']
    assert prepared['variants'][variant]['scoreSha256']==baseline['variants'][variant]['scoreSha256']
for profile in ['soft','original']:
    silence,metrics=engine.mix_row_stems(entry['mixer'],[],False,profile)
    assert metrics['peak']==0
# Block convolution must match the old full-FFT causal filter numerically.
random=np.random.default_rng(9).normal(size=(40000,2))*.01
for hz in [85,240,3000,5200]:
    a=np.exp(-2*np.pi*hz/44100);kernel=(1-a)*a**np.arange(int(np.ceil(np.log(1e-9)/np.log(a))))
    nfft=1<<(len(random)+len(kernel)-2).bit_length()
    expected=np.fft.irfft(np.fft.rfft(random,nfft,axis=0)*np.fft.rfft(kernel,nfft)[:,None],nfft,axis=0)[:len(random)]
    assert np.max(np.abs(expected-engine.soft_row_mixer.lowpass(random,hz)))<1e-12
report={'status':'passed','checkedOn':'2026-10-11','scorePreparationSeconds':seconds,'firstSoftAudioSeconds':soft_seconds,
    'audioRendersOnOpen':0,'backingCallsForSoftPlayback':len(calls),
    'checks':['on-open score and image only','soft playback does not render unused variants',
        'cache remains available during heavy rendering','lazy WAVs equal eager WAVs byte for byte',
        'image scores unchanged','all-muted silence','bounded FFT equals original filter numerically']}
(engine.ROOT/'tests/page-startup-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report))
