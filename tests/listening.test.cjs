const assert = require('node:assert/strict');
const { summarize, validRound, median } = require('./listening-metrics.js');
// Synthetic unit data only. These are never loaded into the listening page or reported as human feedback.
function round(fixture, length, override = {}) {
  return {
    fixture, length, tone: 'warm', device: fixture % 2 ? 'headphones' : 'phone-speaker',
    revealed: false, preferredId: 'expressive',
    scores: [
      { id: 'legacy', values: [3, 3, 3, 3, 4] },
      { id: 'plain', values: [4, 4, 4, 4, 4] },
      { id: 'expressive', values: [4, 4, 4, 4, 4] },
    ], ...override,
  };
}
const complete = Array.from({ length: 12 }, (_, fixture) => ['16', 'full'].map(length => round(fixture, length))).flat();
const empty = summarize([]);
assert.equal(empty.acceptance, false); assert.equal(empty.newerPreference, null); assert.equal(empty.medianEnjoymentImprovement, null);
const accepted = summarize(complete);
assert.equal(accepted.acceptance, true); assert.equal(accepted.completeWarmFixtures, 12);
assert.equal(accepted.newerPreference, 1); assert.equal(accepted.medianEnjoymentImprovement, 1);
assert.equal(accepted.headphones, true); assert.equal(accepted.phoneSpeaker, true);
const oldCoverageLoophole = complete.filter(r => r.length === '16').concat(Array.from({ length: 12 }, () => round(0, 'full')));
assert.equal(summarize(oldCoverageLoophole).distinctFixtures, 12);
assert.equal(summarize(oldCoverageLoophole).fullRounds, 12);
assert.equal(summarize(oldCoverageLoophole).completeWarmFixtures, 1);
assert.equal(summarize(oldCoverageLoophole).acceptance, false, 'repeated full rounds cannot stand in for all-image coverage');
assert.equal(summarize(complete.filter(r => r.length === 'full')).acceptance, false, 'equal-length comparison is required too');
assert.equal(summarize(complete.map(r => ({ ...r, tone: 'glass' }))).acceptance, false, 'initial warm-tone gate must not be replaced by other timbres');
assert.equal(summarize(complete.map(r => ({ ...r, revealed: true }))).acceptance, false, 'revealed rounds are not blind evidence');
assert.equal(summarize(complete.map(r => ({ ...r, device: 'headphones' }))).acceptance, false, 'physical phone-speaker coverage remains needed');
const noAssociation = structuredClone(complete); noAssociation[0].scores[2].values[4] = 3;
assert.equal(summarize(noAssociation).acceptance, false);
const noEnjoyment = structuredClone(complete); noEnjoyment.forEach(r => r.scores[2].values[3] = 3);
assert.equal(summarize(noEnjoyment).acceptance, false);
assert.equal(summarize(complete.map((r, i) => ({ ...r, preferredId: i < 16 ? 'expressive' : 'legacy' }))).acceptance, false, '16/24 does not reach 70 percent');
assert.equal(summarize(complete.map((r, i) => ({ ...r, preferredId: i < 17 ? 'expressive' : 'legacy' }))).acceptance, true, '17/24 reaches 70 percent');
const invalid = [null, round(12, '16'), round(0, 'wrong'), round(0, '16', { revealed: 'false' }), round(0, '16', { scores: [{ id: 'legacy', values: [5, 5, 5, 5, 5] }] })];
invalid.forEach(r => assert.ok(!validRound(r)));
const withInvalid = summarize(complete.concat(invalid));
assert.equal(withInvalid.invalidRounds, invalid.length); assert.equal(withInvalid.blindRounds, 24);
assert.equal(withInvalid.acceptance, true, 'invalid records must not affect valid evidence');
const before = JSON.stringify(complete); summarize(complete); assert.equal(JSON.stringify(complete), before);
assert.equal(median([2, 1]), 1.5); assert.equal(median([3, 1, 2]), 2);
console.log('Passed listening-statistics gates with synthetic data only; no human listening results were created.');
