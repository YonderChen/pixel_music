'use strict';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function binaryBase64(input) {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i), b = input.charCodeAt(i + 1), c = input.charCodeAt(i + 2);
    out += alphabet[a >> 2] + alphabet[(a & 3) << 4 | (b || 0) >> 4] + (i + 1 < input.length ? alphabet[(b & 15) << 2 | (c || 0) >> 6] : '=') + (i + 2 < input.length ? alphabet[c & 63] : '=');
  }
  return out;
}
function decode(input) {
  const data = input.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(data.length * 6 / 8)); let bits = 0, value = 0, pos = 0;
  for (const char of data) { const n = alphabet.indexOf(char); if (n < 0) throw new Error('无效 Base64'); value = (value << 6) | n; bits += 6; if (bits >= 8) { bits -= 8; out[pos++] = (value >> bits) & 255; } }
  return out;
}
module.exports = {binaryBase64, decode};
