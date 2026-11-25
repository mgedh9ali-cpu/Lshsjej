import { sourceFiles } from './source-files.mjs';
import { classroom, registrationSchema } from './classroom.mjs';
import { ownerPage } from './owner.mjs';

const initialized = new WeakMap();
const schema = [
  'CREATE TABLE IF NOT EXISTS class_subjects (name TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS shared_lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, answer INTEGER, created INTEGER NOT NULL)',
  "CREATE TABLE IF NOT EXISTS shared_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, publisher TEXT NOT NULL, request_id TEXT NOT NULL, subject TEXT NOT NULL, title TEXT NOT NULL, image TEXT NOT NULL, added_by TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(publisher,request_id));",
  "CREATE INDEX IF NOT EXISTS shared_sources_subject_id ON shared_sources(subject,id DESC);",
  'CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);',
  'CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);',
  'CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, student TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, reply TEXT);',
  'CREATE INDEX IF NOT EXISTS feedback_student ON feedback(student, created);',
  'CREATE TABLE IF NOT EXISTS approved_shared_sources (source INTEGER PRIMARY KEY)',
  'CREATE INDEX IF NOT EXISTS shared_sources_publisher_created ON shared_sources(publisher,created)',
  ...registrationSchema,
];

async function initialize(binding) {
  if (!initialized.has(binding)) {
    initialized.set(binding, binding.batch(schema.map(sql => binding.prepare(sql))).catch(error => {
      initialized.delete(binding);
      throw error;
    }));
  }
  await initialized.get(binding);
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

async function readJson(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(Error('الطلب كبير جدًا.'), { status: 413 });
    }
    body += decoder.decode(value, { stream: true });
  }
  try { return { data:JSON.parse(body + decoder.decode()), size }; }
  catch { return null; }
}

export default {
  async fetch(request, env, ctx) {
    const send = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    const path = new URL(request.url).pathname;
    if (path !== '/owner' && (request.method !== 'POST' || path !== '/v1/classroom')) {
      return send({ error: 'المسار غير موجود.' }, 404);
    }
    try {
      if (!env.DB || !env.STUDENT_RATE || !env.SUGGESTION_RATE || !env.SUGGESTION_IP_RATE) return send({error:'الربط عبر الإنترنت قيد الإعداد.'}, 503);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const maxStudents = Number(env.QUM_MAX_STUDENTS ?? 200);
      if (!Number.isSafeInteger(maxStudents) || maxStudents < 1 || maxStudents > 10000) throw Error('Invalid classroom capacity');
      const handle = classroom(database(env.DB), env.QUM_OWNER_KEY, () => initialize(env.DB), {
        maxStudents,
        files: sourceFiles(env.SOURCE_FILES, env.QUM_OWNER_KEY),
        ownerDeviceHash: env.QUM_OWNER_DEVICE_HASH,
        async limitSuggestion(student) {
          const limits = await Promise.all([
            env.SUGGESTION_RATE.limit({ key: 'student:' + student }),
            env.SUGGESTION_IP_RATE.limit({ key: ip }),
          ]);
          if (limits.some(limit => !limit.success)) throw Object.assign(Error('انتظر قليلًا ثم حاول مجددًا.'), { status: 429 });
        },
      });
      if (path === '/owner') return await ownerPage(request, env, ctx, handle);
      const authorization = request.headers.get('Authorization') || '';
      if (request.headers.has('X-Source-Upload')) {
        return send(await handle(authorization, {
          op: 'sourcepart', upload: request.headers.get('X-Source-Upload'),
          number: Number(request.headers.get('X-Source-Part')),
        }, request));
      }
      const declaredSize = Number(request.headers.get('Content-Length'));
      if (declaredSize > 1450000) return send({error:'الطلب كبير جدًا.'}, 413);
      const parsed = await readJson(request, 1450000);
      const data = parsed?.data;
      if (data?.op !== 'addsource' && parsed?.size > 32768) return send({error:'الطلب كبير جدًا.'}, 413);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return send({ error: 'صيغة الطلب غير صالحة.' }, 400);
      if (data.op === 'sourcepart') return send({error:'صيغة الطلب غير صالحة.'}, 400);
      if (['register','register-owner','sync','suggest','sources','source','subjects','study','solve','removesource','renamesource'].includes(data.op)) {
        const allowed = await env.STUDENT_RATE.limit({ key: ip });
        if (!allowed.success) {
          return send({ error: 'انتظر قليلًا ثم حاول مجددًا.' }, 429);
        }
      }
      const result = await handle(authorization, data);
      return result instanceof Response ? result : send(result);
    } catch (error) {
      return send({ error: error.status ? error.message : 'تعذّر تنفيذ الطلب على خدمة الصف.' }, error.status || 500);
    }
  },
};
