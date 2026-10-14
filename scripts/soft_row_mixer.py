"""Independent additive renderer inspired by visual-instrument mixing principles.

This module does not import the reference site's code or sounds. Note pitches,
onsets, durations and image sources are supplied by our existing row score.
"""
import math
import numpy as np

SR = 44100
VERSION = 'soft-row-mix-v1'
# Complementary, restrained harmonics rather than automatically chosen GM timbres.
VOICES = [
    {'name': '暖键', 'partials': [1, .24, .075, .025], 'attack': .012, 'decay': .58, 'sustain': .18, 'release': .14, 'cutoff': 3600, 'gain': 1},
    {'name': '柔拨弦', 'partials': [1, .12, .17, .04, .045], 'attack': .014, 'decay': .36, 'sustain': .13, 'release': .12, 'cutoff': 2200, 'gain': .96},
    {'name': '圆木琴', 'partials': [1, .045, .015, .16], 'attack': .010, 'decay': .27, 'sustain': .10, 'release': .10, 'cutoff': 3100, 'gain': 1.05},
    {'name': '轻铃', 'partials': [1, .06, .025, .12, .012], 'attack': .016, 'decay': .82, 'sustain': .12, 'release': .18, 'cutoff': 4500, 'gain': .88},
    # Only selected through an event's voicePreset (low rows of the refined reference layout).
    {'name': '柔低音', 'partials': [1, .32, .09, .03], 'attack': .02, 'decay': .9, 'sustain': .3, 'release': .2, 'cutoff': 1100, 'gain': 1.05},
]
ROW_VOICES = 4  # Rows without a voicePreset keep the original four-voice cycle.

def preset_index(events, row):
    return events[0].get('voicePreset', row % ROW_VOICES) if events else row % ROW_VOICES

def render_voice(events, frames, row, count):
    if events and events[0].get('pitchTransition') in ('scale','glide'):
        return render_connected_voice(events,frames,row,count)
    preset = VOICES[preset_index(events, row)]
    samples = np.zeros((frames, 2), dtype=np.float64)
    activity = np.zeros(frames, dtype=np.float32)
    pan = 0 if count == 1 else -.48 + .96 * row / (count - 1)
    stereo = np.array([math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)])
    for event in events:
        start = max(0, round(event['start'] * SR))
        gate = max(1 / SR, event['duration'])
        size = min(frames - start, math.ceil((gate + preset['release'] * 5) * SR))
        if size <= 0: continue
        t = np.arange(size, dtype=np.float64) / SR
        held = np.minimum(t, gate)
        envelope = (1 - np.exp(-held / preset['attack'])) * (preset['sustain'] + (1 - preset['sustain']) * np.exp(-held / preset['decay']))
        envelope *= np.exp(-np.maximum(0, t - gate) / preset['release'])
        frequency = 440 * 2 ** ((event['midi'] - 69) / 12)
        signal = np.zeros(size)
        energy = 0
        for harmonic, amplitude in enumerate(preset['partials'], 1):
            hz = harmonic * frequency
            if hz >= SR * .45: continue
            amplitude /= math.sqrt(1 + (hz / preset['cutoff']) ** 4)
            # Upper partials settle sooner, leaving a rounder sustained tone.
            partial_decay = 1 if harmonic == 1 else .35 + .65 * np.exp(-t / .32)
            signal += amplitude * partial_decay * np.sin(2 * math.pi * hz * t)
            energy += amplitude ** 2
        signal /= math.sqrt(max(energy, 1e-9))
        velocity = np.clip(event['velocity'], 0, 1)
        compensation = np.clip((440 / max(60, frequency)) ** .16, .82, 1.3)
        level = .14 * preset['gain'] * math.sqrt(velocity) * compensation
        samples[start:start + size] += (signal * envelope * level)[:, None] * stereo
        activity[start:start + size] += envelope * velocity
    return samples, activity

def pitch_segment(target, previous, size, seconds, transition):
    """Smooth frequency, keeping phase integration independent of note changes."""
    tau=.002 if transition=='scale' else min(.09,max(.02,seconds/6))
    t=np.arange(size,dtype=np.float64)/SR
    frequency=target+(previous-target)*np.exp(-t/tau)
    return frequency, float(target+(previous-target)*math.exp(-size/(SR*tau)))

def render_connected_voice(events, frames, row, count):
    """Sustain each adjacent phrase; rests end the phrase and its pitch history."""
    preset=VOICES[preset_index(events,row)]
    samples=np.zeros((frames,2));activity=np.zeros(frames,dtype=np.float32)
    pan=0 if count==1 else -.48+.96*row/(count-1)
    stereo=np.array([math.cos((pan+1)*math.pi/4),math.sin((pan+1)*math.pi/4)])
    phrases=[]
    for event in sorted(events,key=lambda e:e['start']):
        if not phrases or event['start']>phrases[-1][-1]['start']+phrases[-1][-1]['duration']+1/SR:
            phrases.append([])
        phrases[-1].append(event)
    for phrase in phrases:
        start=max(0,round(phrase[0]['start']*SR))
        gate_end=round((phrase[-1]['start']+phrase[-1]['duration'])*SR)
        gate=max(1,gate_end-start)
        size=min(frames-start,gate+round(preset['release']*5*SR))
        if size<=0:continue
        frequency=np.empty(size);velocity=np.empty(size)
        previous=None;previous_velocity=phrase[0]['velocity'];cursor=0
        for event in phrase:
            end=min(size,round((event['start']+event['duration'])*SR)-start)
            length=end-cursor
            if length<=0:continue
            pitch=event['curveMidi'] if event['pitchTransition']=='glide' else event['midi']
            target=440*2**((pitch-69)/12)
            if previous is None:previous=target
            frequency[cursor:end],previous=pitch_segment(target,previous,length,event['duration'],event['pitchTransition'])
            decay=np.exp(-np.arange(length)/(SR*.025))
            velocity[cursor:end]=event['velocity']+(previous_velocity-event['velocity'])*decay
            previous_velocity=float(event['velocity']+(previous_velocity-event['velocity'])*math.exp(-length/(SR*.025)))
            cursor=end
        frequency[cursor:]=previous;velocity[cursor:]=previous_velocity
        # A single phase and amplitude envelope for the phrase, including turns.
        phase=2*math.pi*np.concatenate(([0.],np.cumsum(frequency[:-1])))/SR
        t=np.arange(size)/SR;held=np.minimum(t,gate/SR)
        envelope=(1-np.exp(-held/preset['attack']))*(.48+.52*np.exp(-held/preset['decay']))
        envelope*=np.exp(-np.maximum(0,t-gate/SR)/preset['release'])
        signal=np.zeros(size);energy=np.zeros(size)
        for harmonic,amplitude in enumerate(preset['partials'],1):
            hz=harmonic*frequency
            amplitude=amplitude/np.sqrt(1+(hz/preset['cutoff'])**4)*(hz<SR*.45)
            signal+=amplitude*np.sin(harmonic*phase)
            energy+=amplitude**2
        signal/=np.sqrt(np.maximum(energy,1e-9))
        level=.14*preset['gain']*np.sqrt(np.clip(velocity,0,1))*np.clip((440/np.maximum(60,frequency))**.16,.82,1.3)
        samples[start:start+size]+=(signal*envelope*level)[:,None]*stereo
        activity[start:start+size]+=envelope*velocity
    return samples,activity

def lowpass(samples, hz):
    """Causal one-pole filter with bounded FFT work buffers."""
    a = math.exp(-2 * math.pi * hz / SR)
    kernel = (1 - a) * a ** np.arange(math.ceil(math.log(1e-9) / math.log(a)))
    block = 16384
    nfft = 1 << (block + len(kernel) - 2).bit_length()
    response = np.fft.rfft(kernel, nfft)[:, None]
    output = np.zeros_like(samples)
    for start in range(0, len(samples), block):
        chunk = samples[start:start + block]
        spectrum = np.fft.rfft(chunk, nfft, axis=0)
        spectrum *= response
        filtered = np.fft.irfft(spectrum, nfft, axis=0)
        size = min(len(chunk) + len(kernel) - 1, len(samples) - start)
        output[start:start + size] += filtered[:size]
    return output

def light_echo(samples):
    # One shared linear effect: summing processed stems equals one send bus.
    # Remove bass and damp highs before repeats; no long diffuse reverb tail.
    filtered = lowpass(samples - lowpass(samples, 240), 3000)
    result = samples.copy()
    delay = round(.28 * SR)
    for repeat in range(1, 6):
        offset = repeat * delay
        if offset >= len(samples): break
        result[offset:] += filtered[:-offset] * .13 * .24 ** (repeat - 1)
    return result

def prepare(events, row_ids, frames, background=None):
    stems, activity = {}, np.zeros(frames, dtype=np.float64)
    for row, key in enumerate(row_ids):
        stems[key], active = render_voice([e for e in events if e.get('rowId') == key], frames, row, len(row_ids))
        activity += active
    # Smooth crowd compensation; retain this full-ensemble curve for mute/solo.
    target = 1 / np.sqrt(1 + .65 * np.maximum(0, activity - .5))
    hop = 128
    knots = []
    previous = float(target[0])
    smooth = 1 - math.exp(-hop / (SR * .075))
    for i in range(0, frames, hop):
        previous += (float(np.mean(target[i:i + hop])) - previous) * smooth
        knots.append(previous)
    bus = np.interp(np.arange(frames), np.arange(len(knots)) * hop, knots)
    for key in row_ids: stems[key] = light_echo(stems[key] * bus[:, None])
    if background is not None:
        background = lowpass(background - lowpass(background, 85), 5200)
        rms = float(np.sqrt(np.mean(background ** 2)))
        # Accompaniment stays behind the image melodies, even for a quiet score.
        stems['background'] = background * min(.55, .019 / max(rms, 1e-9))
    full = sum(stems.values(), np.zeros((frames, 2)))
    rms = float(np.sqrt(np.mean(full ** 2)))
    gain = min(3.5, .085 / max(rms, 1e-9))
    names = [VOICES[preset_index([e for e in events if e.get('rowId') == key], row)]['name'] for row, key in enumerate(row_ids)]
    return stems, gain, {'version': VERSION, 'voices': names,
        'pitchTransition':next((e['pitchTransition'] for e in events if 'pitchTransition' in e),'struck'),
        'echoSeconds': .28, 'echoWet': .13, 'echoLowCutHz': 240,
        'fixedSoloGain': True, 'masterGain': gain, 'peakCeiling': .9}

def master(samples, gain):
    samples = samples - np.mean(samples, axis=0)
    # Smooth saturation, bounded for every mute combination, without hard clips.
    samples = .9 * np.tanh(samples * gain / .9)
    tail = min(len(samples), round(.025 * SR))
    samples[-tail:] *= np.linspace(1, 0, tail)[:, None]
    return samples

def preview(event, count=4):
    record = dict(event, start=0, duration=min(.65, event['duration']))
    frames = round(1.5 * SR)
    samples, _ = render_voice([record], frames, int(event.get('row', 0)), count)
    return master(light_echo(samples), 1.5)
