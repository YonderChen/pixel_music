(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicListening = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const dimensions = ['连贯性', '主题记忆感', '节奏舒适度', '整体好听程度', '图片关联感'];
  const profiles = ['legacy', 'plain', 'expressive'];
  const median = values => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  };
  function validRound(round) {
    return round && Number.isInteger(round.fixture) && round.fixture >= 0 && round.fixture < 12 &&
      ['warm', 'glass', 'mist'].includes(round.tone) && ['16', 'full'].includes(round.length) &&
      ['headphones', 'phone-speaker', 'computer-speaker'].includes(round.device) &&
      typeof round.revealed === 'boolean' && profiles.includes(round.preferredId) &&
      Array.isArray(round.scores) && round.scores.length === 3 &&
      profiles.every(id => round.scores.filter(score => score?.id === id).length === 1) &&
      round.scores.every(score => Array.isArray(score.values) && score.values.length === 5 &&
        score.values.every(value => Number.isInteger(value) && value >= 1 && value <= 5));
  }
  function summarize(ratings) {
    const valid = ratings.filter(validRound), blind = valid.filter(round => !round.revealed);
    // Warm-key comparisons establish composition gains; other timbres remain supplementary data.
    const warm = blind.filter(round => round.tone === 'warm');
    const coverage = Array.from({ length: 12 }, (_, fixture) => ({
      fixture,
      short: warm.some(round => round.fixture === fixture && round.length === '16'),
      full: warm.some(round => round.fixture === fixture && round.length === 'full'),
    }));
    const devices = new Set(warm.map(round => round.device));
    const wins = warm.filter(round => round.preferredId !== 'legacy').length;
    const score = (round, id, dimension) => round.scores.find(item => item.id === id).values[dimension];
    const enjoyment = median(warm.map(round => score(round, 'expressive', 3) - score(round, 'legacy', 3)));
    const associationLoss = warm.filter(round => score(round, 'expressive', 4) < score(round, 'legacy', 4)).length;
    const completeFixtures = coverage.filter(item => item.short && item.full).length;
    const preference = warm.length ? wins / warm.length : null;
    return {
      totalRounds: ratings.length, invalidRounds: ratings.length - valid.length,
      blindRounds: blind.length, distinctFixtures: new Set(blind.map(round => round.fixture)).size,
      fullRounds: blind.filter(round => round.length === 'full').length,
      warmBlindRounds: warm.length, completeWarmFixtures: completeFixtures, fixtureCoverage: coverage,
      headphones: devices.has('headphones'), phoneSpeaker: devices.has('phone-speaker'),
      newerPreference: preference, medianEnjoymentImprovement: enjoyment, associationLossRounds: associationLoss,
      acceptance: completeFixtures === 12 && devices.has('headphones') && devices.has('phone-speaker') &&
        preference >= .7 && enjoyment >= 1 && associationLoss === 0,
    };
  }
  return { dimensions, median, validRound, summarize };
});
