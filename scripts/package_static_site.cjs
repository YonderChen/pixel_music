/* Refresh generated static-site files and optionally build the ZIP hand-off package.
 * Usage: node scripts/package_static_site.cjs [--archive]
 * The image engine is plain JavaScript in dist/engine/; nothing here compiles or bundles it. */
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
fs.copyFileSync(path.join(dist, 'feature-music.html'), path.join(dist, 'index.html'));

if (process.argv.includes('--archive')) {
  const names = ['index.html', 'feature-music.html', 'feature-music-app.js', 'browser-engine.js', 'sonification.css', 'sonification-samples.js',
    'sonification-assets/photos.js', 'sonification-assets/paintings.js', 'music-art.html', 'music-art-app.js', 'music-art-core.js',
    'music-art-midi.js', 'music-art-classics.js', 'music-art.css', 'ui.css', 'studio.css', 'favicon.svg', 'icon-192.png', 'icon-512.png',
    'icon-maskable-512.png', 'apple-touch-icon.png', 'site.webmanifest'];
  const listed = folder => fs.readdirSync(path.join(dist, folder)).sort().map(n => folder + '/' + n);
  const walk = folder => fs.readdirSync(path.join(dist, folder), {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : 1)
    .flatMap(e => e.isDirectory() ? walk(folder + '/' + e.name) : [folder + '/' + e.name]);
  const entries = [...names, ...listed('classical-midi'), ...listed('sonification-assets/paintings'), ...walk('engine')]
    .filter(name => fs.statSync(path.join(dist, name)).isFile()).map(name => [name, fs.readFileSync(path.join(dist, name))]);
  entries.push(['使用说明.md', fs.readFileSync(path.join(root, 'docs/STATIC_WEB_DEMO.md'))]);

  // A plain ZIP (deflate, UTF-8 names) written by hand so the script needs nothing beyond Node.
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const file = Buffer.from(name, 'utf8'), packed = zlib.deflateRawSync(data, {level: 6}), crc = zlib.crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(file.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0, 12); entry.writeUInt16LE(0x21, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(file.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, file, packed); central.push(entry, file);
    offset += header.length + file.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const archive = path.join(root, '图鸣-静态网页版.zip');
  fs.writeFileSync(archive, Buffer.concat([...local, directory, end]));
  console.log('Static archive:', archive, fs.statSync(archive).size);
}
