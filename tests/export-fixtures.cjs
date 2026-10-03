const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const fixtures = require('./fixtures.js');
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), buffer = Buffer.alloc(12 + data.length);
  buffer.writeUInt32BE(data.length, 0); name.copy(buffer, 4); data.copy(buffer, 8);
  buffer.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length); return buffer;
}
const target = path.join(__dirname, 'artifacts'); fs.mkdirSync(target, { recursive: true });
fixtures.names.forEach((name, index) => {
  const pixels = fixtures.pixels(index), header = Buffer.alloc(13);
  header.writeUInt32BE(fixtures.width, 0); header.writeUInt32BE(fixtures.height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((fixtures.width * 4 + 1) * fixtures.height);
  for (let y = 0; y < fixtures.height; y++) Buffer.from(pixels.buffer, y * fixtures.width * 4, fixtures.width * 4).copy(rows, y * (fixtures.width * 4 + 1) + 1);
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(target, `fixture-${String(index + 1).padStart(2, '0')}.png`), bytes);
});
console.log(`Exported 12 original PNG fixtures to ${target}`);
