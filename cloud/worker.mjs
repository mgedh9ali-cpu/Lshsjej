import { createHash } from 'node:crypto';
import { classroom } from './classroom.mjs';

let initialized = false;
const schema = [
  'CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);',
  'CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);',
  'CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, student TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, reply TEXT);',
  'CREATE INDEX IF NOT EXISTS feedback_student ON feedback(student, created);',
];

async function initialize(binding) {
  if (initialized) return;
  await binding.batch(schema.map(sql => binding.prepare(sql)));
  initialized = true;
}

function database(binding) {
  return {
    prepare(sql) {
      const statement = binding.prepare(sql);
      const query = args => args.length ? statement.bind(...args) : statement;
      return {
        async all(...args) { return (await query(args).all()).results; },
        get(...args) { return query(args).first(); },
        async run(...args) { return { changes: (await query(args).run()).meta.changes }; },
      };
    },
  };
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) {
      await reader.cancel();
      throw Object.assign(Error('الطلب كبير جدًا.'), { status: 413 });
    }
    body += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(body + decoder.decode()); }
  catch { return null; }
}

export default {
  async fetch(request, env) {
    const send = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/classroom') {
      return send({ error: 'المسار غير موجود.' }, 404);
    }
    try {
      const data = await readJson(request);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return send({ error: 'صيغة الطلب غير صالحة.' }, 400);
      const authorization = request.headers.get('Authorization') || '';
      const device = authorization.match(/^Device ([a-zA-Z0-9_-]{43})$/)?.[1];
      if (device && device === data.device && ['sync', 'suggest'].includes(data.op)) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const allowed = await env.STUDENT_RATE.limit({ key: ip });
        if (!allowed.success || (data.op === 'suggest' &&
            !(await env.SUGGESTION_RATE.limit({ key: createHash('sha256').update(device).digest('hex') })).success)) {
          return send({ error: 'انتظر قليلًا ثم حاول مجددًا.' }, 429);
        }
      }
      const handle = classroom(database(env.DB), env.QUM_OWNER_KEY, env.QUM_STUDENT_KEY, () => initialize(env.DB));
      return send(await handle(authorization, data));
    } catch (error) {
      return send({ error: error.status ? error.message : 'تعذّر تنفيذ الطلب على خدمة الصف.' }, error.status || 500);
    }
  },
};
