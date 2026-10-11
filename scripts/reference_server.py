"""Loopback-only server with in-memory caches; upstream cleans temporary MIDI/WAV files."""
import argparse
import base64
import collections
import hashlib
import json
import pathlib
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import reference_music as engine
import hover_preview

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = collections.OrderedDict()
LOCK = threading.Lock()
SCORE_LOCK = threading.Lock()
RENDER_LOCK = threading.RLock()

def ensure_hover_bank(cached, variant, profile):
    if variant not in ('parallel','reference'):raise ValueError('移动试听版本无效')
    if profile not in ('soft','original'):raise ValueError('移动试听音色无效')
    profile=profile if variant=='parallel' else 'original'
    key=variant+'-'+profile
    with RENDER_LOCK:
        banks=cached.setdefault('hoverBanks',{})
        if key not in banks:
            wav,metadata=hover_preview.build(engine,cached['payload']['variants'][variant],cached['context']['info'],cached['context']['synth'],profile)
            metadata['audioUrl']=f"/api/hover-audio/{cached['payload']['key']}/{key}.wav"
            banks[key]={'wav':wav,'metadata':metadata}
        return banks[key]

def prepare_entry(image, options, key):
    with LOCK: cached=CACHE.get(key)
    if cached is not None: return cached
    with SCORE_LOCK:
        with LOCK: cached=CACHE.get(key)
        if cached is not None: return cached
        payload,context=engine.prepare_scores(image,options)
        payload['key']=key
        for variant in payload['variants']:
            payload['variants'][variant]['audioUrl']=f'/api/audio/{key}/{variant}.wav'
        for profile,meta in payload['variants']['parallel']['mixProfiles'].items():
            suffix='parallel-soft' if profile=='soft' else 'parallel'
            meta['audioUrl']=f'/api/audio/{key}/{suffix}.wav'
        cached={'payload':payload,'context':context,'waves':{},'audioMetrics':{},'mixer':None,'background':None}
        with LOCK:
            CACHE[key]=cached
            while len(CACHE)>4: CACHE.popitem(last=False)
        return cached

def ensure_audio(cached, variant):
    if variant in cached['waves']: return cached['waves'][variant],cached['audioMetrics'][variant]
    # Serialize expensive rendering, while cache reads, static files and scores remain available.
    with RENDER_LOCK:
        if variant in cached['waves']: return cached['waves'][variant],cached['audioMetrics'][variant]
        payload,context=cached['payload'],cached['context']
        if variant in ('parallel','parallel-soft'):
            if context['backing'] and cached['background'] is None:
                records=[e for e in context['reference'] if e['layer']!='main']
                cached['background']=engine.render_score(records,context['info'],context['synth'])[0]
            if variant=='parallel-soft':
                wav,metrics,mixer,meta=engine.render_soft_rows(context,cached['background'])
                if cached['mixer'] is None: cached['mixer']=mixer
                else: cached['mixer']['profiles'].update(mixer['profiles'])
                payload['variants']['parallel']['mixProfiles']['soft'].update(meta,metrics=metrics)
            else:
                wav,metrics,mixer,stems=engine.render_parallel(context['rowEvents'],context['reference'],context['info'],
                    context['synth'],context['voices'],context['backing'],include_soft=False,background_wav=cached['background'])
                if cached['mixer'] is not None: mixer['profiles'].update(cached['mixer']['profiles'])
                cached['mixer']=mixer
                payload['variants']['parallel']['stems']=stems
                for key,data in mixer['wav'].items():
                    cached['waves']['parallel-'+key]=data
                    cached['audioMetrics']['parallel-'+key]=engine.audio_metrics(engine._pcm(data),44100)
                payload['variants']['parallel']['mixProfiles']['original']['metrics']=metrics
        elif variant in ('reference','features'):
            records=payload['variants'][variant]['events']
            if variant=='features' and payload['variants'][variant].get('featureMethod') in ('contour','transition'):
                if context['backing'] and cached['background'] is None:
                    cached['background']=engine.render_score([e for e in context['reference'] if e['layer']!='main'],context['info'],context['synth'])[0]
                wav,metrics,message=engine.render_feature_transition(records,context['info'],context['synth'],cached['background'])
            else: wav,metrics,message=engine.render_score(records,context['info'],context['synth'])
            payload['variants'][variant].update(metrics=metrics,backend=message)
        elif variant.startswith('parallel-') and variant.removeprefix('parallel-') in [v['id'] for v in context['voices']]+['background']:
            ensure_audio(cached,'parallel')
            return cached['waves'][variant],cached['audioMetrics'][variant]
        else: raise ValueError('未知音频版本')
        cached['audioMetrics'][variant]=metrics
        cached['waves'][variant]=wav
        return wav,metrics

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)
    def end_headers(self):
        origin = self.headers.get('Origin', '')
        if origin in ['null', f'http://127.0.0.1:{self.server.server_port}']:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers','Content-Type')
            self.send_header('Access-Control-Allow-Private-Network','true')
            self.send_header('Access-Control-Expose-Headers','X-Audio-Rms, X-Audio-Sha256')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def send(self, status, data, content_type='application/json'):
        self.send_response(status); self.send_header('Content-Type',content_type); self.send_header('Content-Length',str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def send_audio(self, data, metrics):
        self.send_response(200);self.send_header('Content-Type','audio/wav');self.send_header('Content-Length',str(len(data)))
        self.send_header('X-Audio-Rms',str(metrics['first12Rms']));self.send_header('X-Audio-Sha256',hashlib.sha256(data).hexdigest())
        self.end_headers();self.wfile.write(data)
    def do_OPTIONS(self):
        if self.headers.get('Origin') not in ['null', f'http://127.0.0.1:{self.server.server_port}']:
            return self.send(403,b'{}')
        self.send(204,b'')
    def do_GET(self):
        if self.path == '/api/health':
            return self.send(200,json.dumps({'engine':'pixelmusic-reference-v2','upstream':engine.UPSTREAM_SHA,'capabilities':['horizontal-row-ensemble-v1','soft-row-mix-v1','lazy-audio-v1','feature-contour-v1','multi-feature-pitch-v1','hover-note-atlas-v1']}).encode())
        if self.path.startswith('/api/hover-audio/'):
            parts=self.path.split('/')
            if len(parts)!=5:return self.send(404,b'{}')
            with LOCK:cached=CACHE.get(parts[3])
            bank=cached.get('hoverBanks',{}).get(parts[4].removesuffix('.wav')) if cached else None
            if bank is None:return self.send(404,b'{}')
            try:return self.send(200,bank['wav'],'audio/wav')
            except (BrokenPipeError,ConnectionResetError):return
        if self.path.startswith('/api/audio/'):
            parts=self.path.split('/')
            if len(parts)!=5: return self.send(404,b'{}')
            key, variant=parts[3],parts[4].removesuffix('.wav')
            with LOCK: cached=CACHE.get(key)
            if cached is None: return self.send(404,b'{}')
            try:
                data,metrics=ensure_audio(cached,variant)
                return self.send_audio(data,metrics)
            except (BrokenPipeError,ConnectionResetError): return
            except Exception as error: return self.send(400,json.dumps({'error':str(error)},ensure_ascii=False).encode())
        super().do_GET()
    def do_POST(self):
        if self.headers.get('Origin','') not in ['', 'null', f'http://127.0.0.1:{self.server.server_port}']:
            return self.send(403,b'{}')
        try:
            length=int(self.headers.get('Content-Length',0))
            if not 0<length<18*1024*1024: raise ValueError('图片请求过大')
            request=json.loads(self.rfile.read(length))
            if self.path=='/api/generate':
                image=base64.b64decode(request['image'],validate=True)
                options=request.get('options',{})
                key=hashlib.sha256(image+json.dumps(options,sort_keys=True).encode()).hexdigest()
                cached=prepare_entry(image,options,key)
                data=json.dumps(cached['payload'],ensure_ascii=False,allow_nan=False).encode()
                return self.send(200,data)
            if self.path=='/api/rowmix':
                with LOCK: cached=CACHE[request['key']]
                profile=request.get('profile','original')
                if profile not in ('soft','original'): raise ValueError('未知混音风格')
                ensure_audio(cached,'parallel-soft' if profile=='soft' else 'parallel')
                data,metrics=engine.mix_row_stems(cached['mixer'],request['rows'],bool(request.get('background',True)),profile)
                return self.send_audio(data,metrics)
            if self.path=='/api/hover-bank':
                with LOCK:cached=CACHE.get(request['key'])
                if cached is None:raise ValueError('乐谱缓存已失效，请点击“重新生成”。')
                bank=ensure_hover_bank(cached,request['variant'],request.get('profile','original'))
                return self.send(200,json.dumps(bank['metadata'],allow_nan=False).encode())
            if self.path=='/api/preview':
                with LOCK: cached=CACHE[request['key']]
                variant=cached['payload']['variants'][request['variant']]
                record=next(row for row in variant['events'] if row['id']==request['eventId'])
                if (request['variant']=='parallel' and request.get('profile')=='soft') or (request['variant']=='features' and variant.get('featureMethod') in ('contour','transition')):
                    samples=engine.soft_row_mixer.preview(record,variant['rows'] if request['variant']=='parallel' else 1)
                else:
                    with RENDER_LOCK:
                        event=engine.NoteEvent(0,min(.65,record['duration']),record['midi'],record['velocity'],record['instrument'],record['pan'],'main')
                        raw_info=cached['payload']['info'].copy(); raw_info['duration']=.7
                        info=engine.CompositionInfo(**raw_info)
                        samples,message=engine.upstream_audio.render_backend([event],info,cached['payload']['settings']['synth'])
                data=engine.upstream_audio.audio_to_wav_bytes(samples,44100)
                return self.send(200,data,'audio/wav')
            return self.send(404,b'{}')
        except (BrokenPipeError,ConnectionResetError): return
        except Exception as error:
            self.send(400,json.dumps({'error':str(error)},ensure_ascii=False).encode())

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=4176); args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Local: http://127.0.0.1:{args.port}/feature-music.html',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
