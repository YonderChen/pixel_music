"""Arrangement layer: image features steer a small, rule-based ensemble.

Each image row keeps its regions as note sources, but takes one musical role
(melody, counter-line, broken chords or bass) in its own register over one
shared chord progression. Features are normalized within the image, so every
picture uses the full register rather than a narrow absolute band.
"""
import math
import numpy as np
from config import SCALES

VERSION = 'arranged-ensemble-v1'
ROLES = {2: ['melody', 'bass'], 3: ['melody', 'arpeggio', 'bass'], 4: ['melody', 'counter', 'arpeggio', 'bass']}
ROLE_NAMES = {'melody': '主旋律', 'counter': '副旋律', 'arpeggio': '分解和弦', 'bass': '低音'}
REGISTERS = {'melody': (67, 86), 'counter': (55, 74), 'arpeggio': (50, 74), 'bass': (33, 52)}
# Applied after each stem is rendered: the melody leads, the others support it.
ROLE_GAIN = {'melody': 1.0, 'counter': .55, 'arpeggio': .5, 'bass': .62}
ROLE_PAN = {'melody': .06, 'counter': -.4, 'arpeggio': .42, 'bass': -.08}
BACKING_GAIN = .42
REVERB_SEND = 72
# Weighted feature change: below CHANGE a region counts as unchanged; MOVE is a clear change.
CHANGE, MOVE, HARMONY_CHANGE, STILL = .012, .025, .015, .05

PARENT = {'Major pentatonic': [0, 2, 4, 5, 7, 9, 11], 'Major': [0, 2, 4, 5, 7, 9, 11], 'Lydian': [0, 2, 4, 6, 7, 9, 11],
    'Natural minor': [0, 2, 3, 5, 7, 8, 10], 'Minor pentatonic': [0, 2, 3, 5, 7, 8, 10], 'Dorian': [0, 2, 3, 5, 7, 9, 10]}
# Four-bar loops on parent-scale triads (0 = tonic). Indexed by saturation and contrast.
PROGRESSIONS = {
    'major': [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4]],
    'lydian': [[0, 1, 0, 1], [0, 1, 5, 4], [0, 4, 1, 0], [0, 5, 1, 4]],
    'minor': [[0, 5, 2, 6], [0, 3, 6, 2], [0, 5, 3, 6], [0, 6, 5, 6]],
    'dorian': [[0, 3, 0, 3], [0, 3, 6, 0], [0, 6, 3, 0], [0, 2, 3, 6]],
}
FAMILY = {'Major pentatonic': 'major', 'Major': 'major', 'Lydian': 'lydian', 'Natural minor': 'minor',
    'Minor pentatonic': 'minor', 'Dorian': 'dorian'}
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Curated combinations instead of per-row automatic GM picks.
ENSEMBLES = [
    {'id': 'wooden-steps', 'name': '木琴轻步', 'gs': {'melody': 12, 'counter': 24, 'arpeggio': 108, 'bass': 32, 'pad': 89},
        'simple': {'melody': 'marimba', 'counter': 'harp', 'arpeggio': 'kalimba', 'bass': 'soft_bass', 'pad': 'warm_pad'}},
    {'id': 'night-strings', 'name': '夜色弦乐', 'gs': {'melody': 0, 'counter': 42, 'arpeggio': 46, 'bass': 32, 'pad': 49},
        'simple': {'melody': 'soft_piano', 'counter': 'cello', 'arpeggio': 'harp', 'bass': 'soft_bass', 'pad': 'warm_pad'}},
    {'id': 'warm-chamber', 'name': '暖木室内乐', 'gs': {'melody': 73, 'counter': 71, 'arpeggio': 24, 'bass': 42, 'pad': 49},
        'simple': {'melody': 'flute_like_lead', 'counter': 'clarinet_like_reed', 'arpeggio': 'harp', 'bass': 'cello', 'pad': 'warm_pad'}},
    {'id': 'cool-mist', 'name': '冷雾电钢', 'gs': {'melody': 4, 'counter': 11, 'arpeggio': 46, 'bass': 35, 'pad': 88},
        'simple': {'melody': 'soft_piano', 'counter': 'celesta', 'arpeggio': 'harp', 'bass': 'soft_bass', 'pad': 'glass_pad'}},
    {'id': 'morning-piano', 'name': '晨光钢琴', 'gs': {'melody': 0, 'counter': 48, 'arpeggio': 46, 'bass': 32, 'pad': 89},
        'simple': {'melody': 'soft_piano', 'counter': 'bowed_string', 'arpeggio': 'harp', 'bass': 'soft_bass', 'pad': 'warm_pad'}},
]

def choose_ensemble(features):
    b, warm, hi = features['mean_brightness'], features['warmth'], features['high_frequency_energy']
    if hi > .34 and b > .45: return ENSEMBLES[0], '细节丰富且明亮'
    if b < .38: return ENSEMBLES[1], '整体偏暗'
    if warm > .05: return ENSEMBLES[2], '色调偏暖'
    if warm < -.03: return ENSEMBLES[3], '色调偏冷'
    return ENSEMBLES[4], '明暗与冷暖均衡'

def instrument(ensemble, role, synth):
    return f"gm_{ensemble['gs'][role]:03d}" if synth == 'GeneralUser GS' else ensemble['simple'][role]

def chord_pcs(root_pc, parent, degree):
    return [(root_pc + parent[(degree + 2 * k) % 7]) % 12 for k in range(3)]

def chord_name(root_pc, parent, degree):
    pcs = chord_pcs(root_pc, parent, degree)
    third = (pcs[1] - pcs[0]) % 12
    fifth = (pcs[2] - pcs[0]) % 12
    return NOTE_NAMES[pcs[0]] + ('' if third == 4 else 'dim' if fifth == 6 else 'm')

def notes_with(pcs, low, high):
    return [n for n in range(low, high + 1) if n % 12 in pcs]

def normalize(values, minimum_half_span=.03):
    """Centre on the image median; uniform images stay near the middle."""
    values = np.asarray(values, dtype=float)
    if not len(values): return values
    lo, mid, hi = np.percentile(values, [10, 50, 90])
    half = max((hi - lo) / 2, minimum_half_span)
    return np.clip(.5 + (values - mid) / (2 * half), 0, 1)

def smooth(values):
    if len(values) < 3: return np.asarray(values, dtype=float)
    padded = np.concatenate(([values[0]], values, [values[-1]]))
    return .25 * padded[:-2] + .5 * padded[1:-1] + .25 * padded[2:]

def activity(features):
    return .55 * features['texture'] + .3 * min(1, features['contrast'] * 3) + .15 * features['saturation']

def arrange(features, info, root_midi, rows, synth):
    """rows: per image row, a list of beat regions with 'features' and 'contributions'.

    Every musical change has to come from an image change: chords move only when
    the bar band changes, rhythmic density follows absolute texture and contrast,
    and unchanged regions tie into long notes. A uniform image stays nearly still.
    Returns events per row, shared backing events and metadata.
    """
    count = len(rows)
    roles = ROLES[count]
    beat = 60 / info.tempo
    bars = max(1, len(rows[0]) // 4)
    root_pc = root_midi % 12
    parent = PARENT.get(info.scale_name, PARENT['Major'])
    melody_pcs = {(root_pc + i) % 12 for i in SCALES[info.scale_name]}
    family = FAMILY.get(info.scale_name, 'major')
    choice = int(features['mean_saturation'] > .35) * 2 + int(features['contrast'] > .2)
    loop = PROGRESSIONS[family][choice]
    ensemble, ensemble_reason = choose_ensemble(features)

    vectors = [[np.array(list(r['contributions'].values())) for r in row] for row in rows]
    deltas = [[math.inf] + [float(np.sum(np.abs(v[i] - v[i - 1]))) for i in range(1, len(v))] for v in vectors]
    band = [np.mean([vectors[r][c] for r in range(count) for c in range(b * 4, b * 4 + 4)], axis=0) for b in range(bars)]
    step, degrees, moves = 0, [], 0
    for b in range(bars):
        if b and float(np.sum(np.abs(band[b] - band[b - 1]))) >= HARMONY_CHANGE: step += 1
        degrees.append(loop[step % 4])
    if step and bars >= 2: degrees[-1] = 0  # A moving progression closes on the tonic.
    chords = [chord_pcs(root_pc, parent, d) for d in degrees]

    # Density: relative ranks inside the image, capped by absolute texture and contrast.
    acts = [[activity(r['features']) for r in row] for row in rows]
    relative = normalize([a for row in acts for a in row], .04)
    cap = lambda a: -1 if a < STILL else 0 if a < .14 else 1 if a < .28 else 2
    levels = []
    for index, row in enumerate(acts):
        values = relative[index * len(row):(index + 1) * len(row)]
        levels.append([min(0 if v < .38 else 1 if v < .72 else 2, cap(a)) for v, a in zip(values, row)])
    sums = [[sum(r['contributions'].values()) for r in row] for row in rows]
    contours = [smooth(normalize(values)) for values in sums]
    motion = [float(np.clip(np.std(values) / .04, 0, 1)) for values in sums]
    dark = [[r['features']['brightness'] < .03 for r in row] for row in rows]

    def bar_level(row_index, bar):
        return int(round(np.mean(levels[row_index][bar * 4:bar * 4 + 4])))

    def bar_changed(row_index, bar):
        return max(deltas[row_index][bar * 4:bar * 4 + 4]) >= CHANGE

    def note(onset, length, midi, velocity, factor, row_index):
        first = int(onset)
        return {'start': onset * beat, 'duration': length * factor * beat, 'midi': midi, 'velocity': float(velocity),
            'cells': (first, max(first + 1, int(math.ceil(onset + length - 1e-6)))), 'span': (onset, onset + length), 'factor': factor}

    def tie(notes, row_index, limit=4):
        """Unchanged image regions hold the same pitch instead of re-striking it."""
        out = []
        for n in notes:
            p = out[-1] if out else None
            if (p and p['midi'] == n['midi'] and abs(p['span'][1] - n['span'][0]) < 1e-6 and n['span'][1] - p['span'][0] <= limit + 1e-6
                    and max(deltas[row_index][c] for c in range(*n['cells'])) < CHANGE):
                p['span'] = (p['span'][0], n['span'][1]); p['cells'] = (p['cells'][0], n['cells'][1])
                p['duration'] = (p['span'][1] - p['span'][0]) * n['factor'] * beat
            else: out.append(n)
        return out

    melody_line = []  # (start, end, midi) of the melody, for the other voices to avoid.
    results = {}
    order = sorted(range(count), key=lambda i: roles[i] != 'melody')
    for index in order:
        role = roles[index]
        low, high = REGISTERS[role]
        contour, row = contours[index], rows[index]
        inst = instrument(ensemble, role, synth)
        notes = []
        if role == 'melody':
            previous = None; repeats = 0; last_leap = 0
            for bar in range(bars):
                for half in (0, 2):
                    b0 = bar * 4 + half
                    level = max(0, levels[index][b0], levels[index][b0 + 1])
                    front = acts[index][b0] >= acts[index][b0 + 1]
                    cells = [[2], [1, 1] if front else [1.5, .5], [.5, .5, 1] if front else [1, .5, .5]][level]
                    phrase_end = bar % 4 == 3 and half == 2 and bar_changed(index, bar)
                    final = bar == bars - 1 and half == 2
                    if phrase_end or final: cells = [2]
                    position = 0
                    for length in cells:
                        onset = b0 + position; cell = int(onset)
                        position += length
                        if dark[index][cell]: previous = None; continue
                        target = low + contour[cell] * (high - low)
                        strong = onset % 2 == 0 or length >= 1.5
                        if final and step: candidates = notes_with({root_pc}, low, high)
                        elif strong: candidates = notes_with(set(chords[bar]), low, high)
                        else: candidates = notes_with(melody_pcs | set(chords[bar]), low, high)
                        change = deltas[index][cell]
                        def cost(n):
                            value = abs(n - target)
                            if previous is not None:
                                interval = n - previous
                                value += .7 * max(0, abs(interval) - 5)
                                if n == previous:
                                    # Same image, same note; a clear change asks for movement.
                                    if change < CHANGE: value -= 1.2
                                    elif change >= MOVE and repeats >= 1: value += 1.6
                                if abs(last_leap) > 4 and interval * last_leap > 0: value += 2.5
                            return value
                        midi = min(candidates, key=lambda n: (cost(n), n))
                        repeats = repeats + 1 if midi == previous else 0
                        last_leap = 0 if previous is None else midi - previous
                        previous = midi
                        f = row[cell]['features']
                        phrase = ((bar % 4) * 4 + half + position - length) / 16
                        velocity = (.5 + .2 * min(1, f['contrast'] * 3) + .08 * f['saturation'] + .08 * motion[index] * math.sin(math.pi * phrase)
                            + (.05 if onset % 4 == 0 else 0))
                        notes.append(note(onset, length, midi, np.clip(velocity, .35, .9), .75 if phrase_end and not final else .96, index))
            notes = tie(notes, index)
            melody_line = [(n['span'][0] * beat, n['span'][1] * beat, n['midi']) for n in notes]
        elif role == 'counter':
            previous = None
            for bar in range(bars):
                cells = [4] if bar_level(index, bar) <= 0 or bar == bars - 1 else [2, 2]
                position = 0
                for length in cells:
                    onset = bar * 4 + position; position += length
                    if dark[index][onset]: previous = None; continue
                    target = low + contour[onset] * (high - low)
                    start, end = onset * beat, (onset + length) * beat
                    above = [m for s, e, m in melody_line if s < end and e > start]
                    still = max(deltas[index][onset:onset + length]) < CHANGE
                    def cost(n):
                        value = .45 * abs(n - target) + (.55 * abs(n - previous) if previous is not None else 0)
                        if previous is not None and n == previous and still: value -= 1.2
                        if n % 12 == chords[bar][0]: value += 1.2  # Leave the root to the bass.
                        for m in above:
                            if n > m - 3: value += 6
                            if (m - n) % 12 in (1, 2, 10, 11): value += 4
                        return value
                    midi = min(notes_with(set(chords[bar]), low, high), key=lambda n: (cost(n), n))
                    previous = midi
                    f = row[onset]['features']
                    notes.append(note(onset, length, midi, np.clip(.42 + .16 * min(1, f['contrast'] * 3), .3, .66), .97, index))
            notes = tie(notes, index)
        elif role == 'arpeggio':
            # Index level + 1: a still bar holds one chord tone.
            patterns = [[1], [0, 1, 2, 1], [0, 2, 3, 2, 1, 2, 3, 2], [0, 1, 2, 3, 4, 3, 2, 1]]
            for bar in range(bars):
                if all(dark[index][bar * 4:bar * 4 + 4]): continue
                level = bar_level(index, bar)
                if bar == bars - 1: level = min(level, 0)
                centre = low + float(np.mean(contour[bar * 4:bar * 4 + 4])) * (high - low - 12)
                roots = notes_with({chords[bar][0]}, low, high - 7)
                base = min(roots, key=lambda n: abs(n - centre))
                voicing = sorted(n for n in notes_with(set(chords[bar]), base, min(base + 17, high)))[:5]
                pattern = patterns[level + 1]
                beats = 4 / len(pattern)
                for k, degree in enumerate(pattern):
                    onset = bar * 4 + k * beats; cell = int(onset)
                    if dark[index][cell]: continue
                    ring = min(beats * 1.8, bar * 4 + 4 - onset) / beats
                    velocity = .34 + .12 * max(0, levels[index][cell]) / 2 + (.05 if k == 0 and len(pattern) > 1 else 0)
                    notes.append(note(onset, beats, voicing[min(degree, len(voicing) - 1)], np.clip(velocity, .28, .58), ring, index))
            notes = tie(notes, index)
        else:  # bass
            previous = None
            boost = 1 if count == 2 else 0  # Without broken chords, the bass moves more.
            for bar in range(bars):
                if all(dark[index][bar * 4:bar * 4 + 4]): previous = None; continue
                level = bar_level(index, bar)
                level = -1 if bar == bars - 1 else min(2, level + boost) if level >= 0 else -1
                target = low + 3 + float(np.mean(contour[bar * 4:bar * 4 + 4])) * (high - low - 10)
                roots = notes_with({chords[bar][0]}, low, high - 7)
                root = min(roots, key=lambda n: abs(n - previous) + .3 * abs(n - target) if previous is not None else abs(n - target))
                fifth = root + (chords[bar][2] - chords[bar][0]) % 12
                octave = root + 12 if root + 12 <= high else root
                plan = [[(0, 4, root)], [(0, 4, root)], [(0, 2, root), (2, 2, fifth)], [(0, 1, root), (1, 1, fifth), (2, 1, octave), (3, 1, fifth)]][level + 1]
                previous = root
                for offset, length, midi in plan:
                    onset = bar * 4 + offset
                    if dark[index][onset]: continue
                    velocity = .56 + (.06 if offset == 0 and len(plan) > 1 else 0) + .1 * max(0, levels[index][onset]) / 2
                    notes.append(note(onset, length, midi, np.clip(velocity, .4, .78), .94, index))
            notes = tie(notes, index)
        for n in notes: n.pop('span'); n.pop('factor')
        results[index] = {'role': role, 'instrument': inst, 'notes': notes}

    backing = pad_events(chords, beat, instrument(ensemble, 'pad', synth))
    names = [chord_name(root_pc, parent, d) for d in degrees]
    meta = {'version': VERSION, 'ensemble': ensemble['name'], 'ensembleReason': ensemble_reason,
        'key': NOTE_NAMES[root_pc], 'progression': compress(names), 'harmonyChanges': step,
        'roles': [ROLE_NAMES[r] for r in roles], 'reverbSend': REVERB_SEND}
    return results, backing, meta

def compress(names):
    """Bar-by-bar chord names with repeats collapsed, for display."""
    return [n for i, n in enumerate(names) if i == 0 or n != names[i - 1]]

def pad_events(chords, beat, inst):
    """A quiet sustained pad; unchanged chords keep sounding instead of re-striking."""
    backing, voicing, start = [], None, 0
    for bar, pcs in enumerate(chords + [None]):
        if pcs is not None and bar and pcs == chords[bar - 1]: continue
        if voicing is not None:
            for midi in voicing:
                backing.append({'start': start * 4 * beat, 'duration': ((bar - start) * 4 + .05) * beat, 'midi': midi,
                    'velocity': .3, 'instrument': inst, 'pan': 0, 'layer': 'pad'})
        if pcs is None: break
        options = [sorted(c) for c in _triad_voicings(pcs, 52, 72)]
        voicing = min(options, key=lambda v: sum(abs(a - b) for a, b in zip(v, voicing)) if voicing else abs(v[0] - 57))
        start = bar
    return backing

def harmonize(events, info, root_midi, bars, synth):
    """Chords inferred from the notes the rows actually play; held while the notes allow it."""
    beat = 60 / info.tempo
    root_pc = root_midi % 12
    parent = PARENT.get(info.scale_name, PARENT['Major'])
    triads = [chord_pcs(root_pc, parent, d) for d in range(7)]
    # A sustained diminished pad sounds tense; leave it out of the candidates.
    usable = [d for d in range(7) if not chord_name(root_pc, parent, d).endswith('dim')]
    degrees, previous = [], None
    for bar in range(bars):
        lo, hi = bar * 4 * beat, (bar + 1) * 4 * beat
        weight = np.zeros(12)
        for e in events:
            overlap = min(hi, e['start'] + e['duration']) - max(lo, e['start'])
            if overlap > 0: weight[e['midi'] % 12] += overlap * e['velocity']
        total = float(weight.sum())
        if total <= 1e-9:
            degrees.append(previous if previous is not None else 0); continue
        score = lambda d: sum(weight[pc] for pc in triads[d]) - .6 * (total - sum(weight[pc] for pc in triads[d]))
        best = max(usable, key=lambda d: (score(d), d == 0, -d))
        keep = previous if previous is not None else 0
        # Keep the current chord unless another one fits the bar clearly better.
        degree = keep if score(keep) >= score(best) - .25 * total else best
        degrees.append(degree); previous = degree
    chords = [triads[d] for d in degrees]
    inst = 'gm_089' if synth == 'GeneralUser GS' else 'warm_pad'
    names = [chord_name(root_pc, parent, d) for d in degrees]
    return pad_events(chords, beat, inst), {'key': NOTE_NAMES[root_pc], 'progression': compress(names),
        'harmonyChanges': sum(1 for i in range(1, len(names)) if names[i] != names[i - 1])}

def _triad_voicings(pcs, low, high):
    for bass in notes_with(set(pcs), low, high):
        voice = [bass]
        for _ in range(2):
            voice.append(next(n for n in range(voice[-1] + 1, voice[-1] + 13) if n % 12 in pcs and n % 12 not in {v % 12 for v in voice}))
        if voice[-1] <= high + 4: yield voice

def vlq(value):
    value = max(0, int(value)); out = [value & 0x7F]; value >>= 7
    while value:
        out.append(0x80 | (value & 0x7F)); value >>= 7
    return bytes(reversed(out))

def midi_bytes(events, tempo):
    """Standard MIDI file with correct multi-byte delta times, pan and reverb send.

    The pinned upstream writer only encodes deltas below 128 ticks correctly;
    this replacement is used only while rendering the arranged combination.
    """
    import struct
    from audio import midi_channel
    from config import GM_PROGRAMS, PERCUSSION_NOTES
    from utils import clamp
    ppq = 480
    tps = ppq * tempo / 60.0
    raw = [(0, 0, b"\xFF\x51\x03" + int(round(60_000_000 / tempo)).to_bytes(3, "big"))]
    seen = set()
    for ev in events:
        if ev.instrument == "none": continue
        ch = midi_channel(ev)
        if ch in seen or ch == 9: continue
        seen.add(ch)
        program = int(GM_PROGRAMS.get(ev.instrument, 0))
        pan = int(clamp(round(64 + ev.pan * 63), 0, 127))
        raw += [(0, 0, bytes([0xC0 | ch, program])), (0, 0, bytes([0xB0 | ch, 91, REVERB_SEND])), (0, 0, bytes([0xB0 | ch, 10, pan]))]
    for ev in events:
        if ev.instrument == "none": continue
        ch = midi_channel(ev)
        note = PERCUSSION_NOTES.get(ev.instrument, 75) if ch == 9 else int(clamp(ev.midi, 0, 127))
        start = int(round(ev.start * tps)); end = int(round((ev.start + max(.05, ev.duration)) * tps))
        raw.append((start, 2, bytes([0x90 | ch, note, int(clamp(ev.velocity, .05, 1) * 110)])))
        raw.append((end, 1, bytes([0x80 | ch, note, 0])))
    raw.sort(key=lambda x: (x[0], x[1]))
    track, last = bytearray(), 0
    for tick, _, payload in raw:
        track += vlq(tick - last) + payload; last = tick
    track += vlq(0) + b"\xFF\x2F\x00"
    return b"MThd" + struct.pack(">IHHH", 6, 0, 1, ppq) + b"MTrk" + struct.pack(">I", len(track)) + bytes(track)
