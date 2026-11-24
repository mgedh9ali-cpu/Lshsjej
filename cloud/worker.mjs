import { classroom } from './classroom.mjs';

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
      const handle = classroom(database(env.DB), env.QUM_OWNER_KEY, env.QUM_STUDENT_KEY, env.QUM_OWNER_DEVICE_HASH);
      return send(await handle(request.headers.get('Authorization') || '', data));
    } catch (error) {
      return send({ error: error.status ? error.message : 'تعذّر تنفيذ الطلب على خدمة الصف.' }, error.status || 500);
    }
  },
};
