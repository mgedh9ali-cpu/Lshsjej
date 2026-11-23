// Build-time assets only. The installed app reads its engine and weights offline.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const target = process.argv[2];
if (!target) throw Error('Usage: node scripts/prepare-ocr.mjs <Android assets directory>');
await mkdir(target, { recursive: true });
const require = createRequire(import.meta.url);
let engineDir = process.env.TESSERACT_CORE_DIR;
if (!engineDir) {
  try {
    engineDir = resolve(require.resolve('tesseract.js-core/package.json'), '..');
  } catch {
    if (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)
      engineDir = join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'tesseract.js-core');
  }
}
async function asset(name, directory, url, hash) {
  let bytes;
  if (directory) {
    try { bytes = await readFile(join(directory, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!bytes) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error('Could not download ' + name + ': ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== hash)
    throw Error('Unexpected checksum for ' + name);
  return bytes;
}
const cdn = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/';
const core = 'tesseract-core-lstm.wasm.js';
await writeFile(join(target, 'core.js'), await asset(core, engineDir, cdn + core,
  'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680'));
const models = {};
for (const [lang, hash] of Object.entries({
  ara: 'e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729',
  eng: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
})) {
  const name = lang + '.traineddata';
  const url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/' + name;
  models[lang] = (await asset(name, process.env.TESSDATA_DIR, url, hash)).toString('base64');
}
await writeFile(join(target, 'models.js'), 'globalThis.models=' + JSON.stringify(models) + ';\n');
const license = await asset('LICENSE', engineDir, cdn + 'LICENSE', 'c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08');
await writeFile(join(target, 'ocr-license.txt'),
  'Tesseract.js Core 7.0.0 and Tesseract tessdata_fast (ara, eng)\n' +
  'https://github.com/naptha/tesseract.js-core\nhttps://github.com/tesseract-ocr/tessdata_fast\n\n' + license);
