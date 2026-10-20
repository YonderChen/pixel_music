/* Build dist/ into a folder that can be published as a claude.ai Artifact.
 * Usage: node scripts/build_claude_artifact.cjs [out_dir]   (default: build/claude-artifact)
 * The main page (index.html) is published without its own document skeleton because
 * the host wraps it in one. dist/ itself is left untouched. */
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'build/claude-artifact');
const TITLE = '图鸣 Pixel Music';

fs.rmSync(out, {recursive: true, force: true});
fs.cpSync(dist, out, {recursive: true, filter: source => {
  const name = path.basename(source);
  // Original MIDI files are only offered as downloads, which the Artifact viewer blocks.
  return name !== '_headers' && !name.endsWith('.mid');
}});

// The main page loses its document skeleton; the host supplies one.
const index = path.join(out, 'index.html');
const page = fs.readFileSync(index, 'utf8')
  .replace(/<!doctype html>\s*|<\/?html[^>]*>\s*|<\/?head>\s*|<\/?body>\s*/gi, '')
  .replace(/<title>[\s\S]*?<\/title>/i, `<title>${TITLE}</title>`);
fs.writeFileSync(index, page);

const files = fs.readdirSync(out, {recursive: true}).map(n => path.join(out, n)).filter(p => fs.statSync(p).isFile()).sort();
for (const file of files) {
  if (fs.statSync(file).size > 16 * 1024 * 1024) { console.error(`${file} is over the 16 MB Artifact file limit`); process.exit(1); }
}
const total = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
console.log(`Built ${out} (${(total / 1e6).toFixed(1)} MB)`);
