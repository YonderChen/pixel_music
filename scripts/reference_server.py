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

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = collections.OrderedDict()
LOCK = threading.Lock()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)
    def end_headers(self):
        origin = self.headers.get('Origin', '')
        if origin in ['null', f'http://127.0.0.1:{self.server.server_port}']:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers','Content-Type')
            self.send_header('Access-Control-Allow-Private-Network','true')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def send(self, status, data, content_type='application/json'):
        self.send_response(status); self.send_header('Content-Type',content_type); self.send_header('Content-Length',str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        if self.headers.get('Origin') not in ['null', f'http://127.0.0.1:{self.server.server_port}']:
            return self.send(403,b'{}')
        self.send(204,b'')
    def do_GET(self):
        if self.path == '/api/health':
            return self.send(200,json.dumps({'engine':'pixelmusic-reference-v2','upstream':engine.UPSTREAM_SHA}).encode())
        if self.path.startswith('/api/audio/'):
            parts=self.path.split('/')
            if len(parts)!=5: return self.send(404,b'{}')
            key, variant=parts[3],parts[4].removesuffix('.wav')
            with LOCK: data=CACHE.get(key,{}).get('waves',{}).get(variant)
            return self.send(200,data,'audio/wav') if data else self.send(404,b'{}')
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
                with LOCK:
                    if key not in CACHE:
                        payload,waves=engine.build(image,options)
                        payload['key']=key
                        for variant in payload['variants']:
                            payload['variants'][variant]['audioUrl']=f'/api/audio/{key}/{variant}.wav'
                        CACHE[key]={'payload':payload,'waves':waves}
                        while len(CACHE)>4: CACHE.popitem(last=False)
                    payload=CACHE[key]['payload']
                    data=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
                return self.send(200,data)
            if self.path=='/api/preview':
                with LOCK:
                    cached=CACHE[request['key']]
                    variant=cached['payload']['variants'][request['variant']]
                    record=next(row for row in variant['events'] if row['id']==request['eventId'])
                    event=engine.NoteEvent(0,min(.65,record['duration']),record['midi'],record['velocity'],record['instrument'],record['pan'],'main')
                    raw_info=cached['payload']['info'].copy(); raw_info['duration']=.7
                    info=engine.CompositionInfo(**raw_info)
                    samples,message=engine.upstream_audio.render_backend([event],info,cached['payload']['settings']['synth'])
                    data=engine.upstream_audio.audio_to_wav_bytes(samples,44100)
                return self.send(200,data,'audio/wav')
            return self.send(404,b'{}')
        except Exception as error:
            self.send(400,json.dumps({'error':str(error)},ensure_ascii=False).encode())

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=4176); args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Local: http://127.0.0.1:{args.port}/feature-music.html',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
