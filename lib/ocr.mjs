import { spawn } from 'node:child_process';

export const normalizeTopic = text => text.normalize('NFKC').toLowerCase()
  .replace(/[\u0640\u064b-\u065f\u0670]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const prefixes = /^(?:(?:درس|شرح|ملخص|مراجعه|تمارين|تطبيقات|امثله|مسائل|موضوع|lesson|notes|review|exercises|examples)\s+(?:(?:عن|علي|on|of)\s+)?)+/u;
export const topicKey = title => normalizeTopic(title).replace(prefixes, '');
const tokens = title => topicKey(title).split(' ').filter(Boolean);

export function duplicateTopic(title, body, topics) {
  const key = topicKey(title);
  if (!key) return undefined;
  const exact = topics.find(topic => topicKey(topic.title) === key);
  if (exact) return exact;
  const incoming = tokens(title);
  if (incoming.length < 2) return undefined;
  const firstLines = normalizeTopic(body.split('\n').slice(0, 4).join(' '));
  const possible = topics.filter(topic => {
    const previous = tokens(topic.title);
    if (previous.length < 2 || Math.abs(previous.length - incoming.length) > 1) return false;
    return incoming.length === previous.length
      && incoming.every(word => previous.includes(word))
      && (' ' + firstLines + ' ').includes(' ' + previous.join(' ') + ' ');
  });
  return possible.length === 1 ? possible[0] : undefined;
}

function runOcr(bytes, languages, pageMode) {
  return new Promise((resolve, reject) => {
    const child = spawn('tesseract', ['stdin', 'stdout', '-l', languages, '--psm', String(pageMode), '-c', 'tessedit_create_tsv=1'], {
      signal: AbortSignal.timeout(15000), env: { ...process.env, OMP_THREAD_LIMIT: '1' },
    });
    const chunks = [];
    let size = 0;
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 1_000_000) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('close', code => {
      if (code === 0 && size <= 1_000_000) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(Error('OCR failed'));
    });
    child.stdin.end(bytes);
  });
}

export function parseOcr(table) {
  const lines = new Map();
  let count = 0;
  let sum = 0;
  for (const row of table.split(/\r?\n/).slice(1)) {
    const columns = row.split('\t');
    const word = columns[11]?.trim();
    const confidence = Number(columns[10]);
    if (columns[0] !== '5' || !word || confidence < 0 || !Number.isFinite(confidence)) continue;
    const id = columns.slice(1, 5).join(':');
    if (!lines.has(id)) lines.set(id, []);
    lines.get(id).push(word);
    count++;
    sum += confidence;
  }
  const records = [...lines.values()].map(words => words.join(' ').trim()).filter(Boolean);
  const body = records.filter(line => !/^(?:اسم\s+الطالب|رقم\s+(?:الهاتف|الجوال)|student\s+name|phone\s+number)\s*[:：]/iu.test(line))
    .map(line => line.replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '').trim()).filter(Boolean);
  const title = body.slice(0, 3).find(line => line.length >= 4 && line.length <= 100 && /\p{L}/u.test(line)) || '';
  return {
    title, body: body.join('\n'),
    readable: count >= 7 && sum / count >= 74 && body.join(' ').length >= 32 && Boolean(title),
  };
}

export async function localOcr(bytes, topics, languages = 'ara+eng') {
  let result = parseOcr(await runOcr(bytes, languages, 6));
  if (!result.readable) result = parseOcr(await runOcr(bytes, languages, 11));
  if (!result.readable) return result;
  return { ...result, duplicateId: duplicateTopic(result.title, result.body, topics)?.id ?? null };
}
