const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise musical invariants independently of browser rendering or audio hardware.
const element = () => ({ addEventListener() {}, classList: { add() {}, remove() {} } });
const context = vm.createContext({
  document: { querySelector: element, querySelectorAll: () => [] },
  window: { addEventListener() {} },
});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../dist/app.js'), 'utf8'), context);
const { arrange, modes } = vm.runInContext('({ arrange: arrangeRegions, modes: MODES })', context);

function imageRegions(seed) {
  let state = seed;
  const random = () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
  return Array.from({ length: 24 }, (_, col) => ({ notes: Array.from({ length: 5 }, (_, row) => ({
    col, row, light: random(), hue: random(), density: random(), velocity: .04 + random() * .04, signature: random() - .5,
  })) }));
}

let count = 0;
for (const mode of Object.values(modes)) {
  for (let root = 0; root < 12; root++) {
    for (let seed = 1; seed <= 12; seed++) {
      const columns = imageRegions(seed);
      const result = arrange(columns, root, mode);
      assert.equal(result.melody.length, 120, 'all regions must remain audible');
      assert.equal(new Set(result.melody.map(note => `${note.col}:${note.row}`)).size, 120);
      assert.equal(result.totalBeats, 48, 'twelve complete four-beat bars');
      assert.equal(result.melody.at(-1).midi, 60 + root, 'finish on the tonic');
      const midi = result.melody.map(note => note.midi);
      assert.ok(new Set(midi).size >= 4, 'a phrase must have a melodic contour');
      assert.ok(Math.max(...midi) - Math.min(...midi) <= 19, 'avoid multi-octave sweeps');
      assert.ok(midi.every((pitch, i) => !i || Math.abs(pitch - midi[i - 1]) <= 7), 'avoid abrupt melodic leaps');
      result.melody.forEach((note, index) => {
        assert.ok(Number.isFinite(note.beat) && note.beats > 0);
        assert.ok(!index || note.beat > result.melody[index - 1].beat, 'play regions one at a time');
        assert.equal(columns[note.col].notes[note.row].midi, note.midi, 'preview matches playback');
        if (note.strong) {
          assert.ok(result.bars[note.bar].chord.some(pitch => pitch % 12 === (note.midi - 60 - root + 12) % 12), 'strong beats fit harmony');
        }
      });
      const second = arrange(imageRegions(seed), root, mode);
      assert.equal(JSON.stringify(result), JSON.stringify(second), 'same pixels give the same music');
      count++;
    }
  }
}
assert.notEqual(JSON.stringify(arrange(imageRegions(1), 0, modes.soft).melody.map(note => note.midi)), JSON.stringify(arrange(imageRegions(2), 0, modes.soft).melody.map(note => note.midi)), 'image features must affect melody pitches');
console.log(`Passed ${count} musical arrangement cases: region coverage, rhythm, harmony, pitch continuity, cadence and reproducibility.`);
