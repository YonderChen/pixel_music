// Explicit inbound asset download. Normal tests never call the network.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { root, readJson, sha256 } = require('./utils.cjs');
const run = promisify(execFile);
const sources = readJson('tests/m0/photo-sources.json');
const directory = path.join(root, 'tests/artifacts/m0-photo-originals');
async function fetchPhoto(photo) {
  const file = path.join(directory, photo.file);
  if (fs.existsSync(file) && photo.sourceSha256 && sha256(fs.readFileSync(file)) === photo.sourceSha256) return { id: photo.id, sha256: photo.sourceSha256, reused: true };
  try {
    await run('curl', ['-L', '--fail', '--silent', '--show-error', '--max-time', '45', '--max-filesize', '12000000', photo.url, '--output', file], { timeout: 50000 });
  } catch (curlError) {
    // Some hosts fail with the system LibreSSL transport. Keep HTTPS certificate
    // verification on and try Node's existing transport, never --insecure.
    const response = await fetch(photo.url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('HTTPS download failed: ' + response.status);
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 12000000) throw new Error('Photo exceeds 12MB download limit');
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    fs.writeFileSync(file, body);
  }
  const actual = sha256(fs.readFileSync(file));
  if (photo.sourceSha256 && actual !== photo.sourceSha256) throw new Error(photo.id + ': upstream checksum mismatch');
  return { id: photo.id, sha256: actual, bytes: fs.statSync(file).size };
}
async function main() {
  if (!process.argv.includes('--download')) throw new Error('Use --download explicitly; all M0 checks run offline.');
  fs.mkdirSync(directory, { recursive: true });
  let cursor = 0; const results = [];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < sources.photos.length) {
      const photo = sources.photos[cursor++];
      try { const result = await fetchPhoto(photo); results.push(result); console.log(JSON.stringify(result)); }
      catch (error) { results.push({ id: photo.id, error: error.message }); console.log(JSON.stringify(results.at(-1))); }
    }
  }));
  if (results.some(result => result.error)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
