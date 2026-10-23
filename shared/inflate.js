/* Small RFC 1950/1951 decoder for PNG IDAT. No browser globals or native addons.
 * Bounds and checksum checks keep corrupt images from growing memory without limit. */
'use strict';
const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const distanceBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const distanceExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const fail = () => { throw new Error('PNG 压缩数据损坏或超出内存限制'); };
function tree(lengths) {
  const count = new Uint16Array(16), next = new Uint16Array(16), tables = [];
  for (const n of lengths) { if (n > 15) fail(); if (n) count[n]++; }
  let code = 0;
  for (let n = 1; n <= 15; n++) { code = (code + count[n - 1]) << 1; if (code + count[n] > 1 << n) fail(); next[n] = code; }
  lengths.forEach((n, symbol) => { if (!n) return; let code = next[n]++, reverse = 0; for (let i = 0; i < n; i++) { reverse = reverse << 1 | code & 1; code >>>= 1; } (tables[n] || (tables[n] = new Map())).set(reverse, symbol); });
  return tables;
}
module.exports = function inflate(input, limit = 96 * 1024 * 1024) {
  if (input.length < 6 || (input[0] & 15) !== 8 || input[0] >> 4 > 7 || ((input[0] << 8) + input[1]) % 31 || input[1] & 32) fail();
  let pos = 2, bits = 0, value = 0, size = 0, out = new Uint8Array(Math.min(32768, limit));
  function read(n) { while (bits < n) { if (pos >= input.length - 4) fail(); value |= input[pos++] << bits; bits += 8; } const result = value & ((1 << n) - 1); value >>>= n; bits -= n; return result; }
  function symbol(t) { let code = 0; for (let n = 1; n <= 15; n++) { code |= read(1) << (n - 1); if (t[n] && t[n].has(code)) return t[n].get(code); } fail(); }
  function reserve(n) { if (size + n > limit) fail(); if (size + n > out.length) { const bigger = new Uint8Array(Math.min(limit, Math.max(size + n, out.length * 2))); bigger.set(out); out = bigger; } }
  let final;
  do {
    final = read(1); const type = read(2);
    if (type === 0) {
      bits = value = 0;
      const length = read(16), complement = read(16); if ((length ^ complement) !== 65535) fail(); reserve(length);
      for (let i = 0; i < length; i++) out[size++] = read(8);
      continue;
    }
    let literal, distance;
    if (type === 1) { literal = tree(Array.from({length: 288}, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)); distance = tree(new Array(32).fill(5)); }
    else if (type === 2) {
      const nl = read(5) + 257, nd = read(5) + 1, nc = read(4) + 4, lengths = new Array(19).fill(0), order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      for (let i = 0; i < nc; i++) lengths[order[i]] = read(3);
      const codes = tree(lengths), all = [];
      while (all.length < nl + nd) {
        const s = symbol(codes);
        if (s < 16) all.push(s);
        else { if (s === 16 && !all.length) fail(); const count = s === 16 ? read(2) + 3 : s === 17 ? read(3) + 3 : read(7) + 11; const v = s === 16 ? all[all.length - 1] : 0; if (all.length + count > nl + nd) fail(); for (let i = 0; i < count; i++) all.push(v); }
      }
      if (!all[256]) fail(); literal = tree(all.slice(0, nl)); distance = tree(all.slice(nl));
    } else fail();
    for (;;) {
      const s = symbol(literal); if (s === 256) break;
      if (s < 256) { reserve(1); out[size++] = s; }
      else { if (s > 285) fail(); const l = s - 257, length = lengthBase[l] + read(lengthExtra[l]), d = symbol(distance); if (d > 29) fail(); const offset = distanceBase[d] + read(distanceExtra[d]); if (offset > size) fail(); reserve(length); for (let i = 0; i < length; i++) { out[size] = out[size - offset]; size++; } }
    }
  } while (!final);
  let a = 1, b = 0; for (let i = 0; i < size; i++) { a = (a + out[i]) % 65521; b = (b + a) % 65521; }
  const n = input.length, checksum = ((input[n-4] << 24) | (input[n-3] << 16) | (input[n-2] << 8) | input[n-1]) >>> 0;
  if (((b << 16 | a) >>> 0) !== checksum) fail();
  return out.slice(0, size);
};
