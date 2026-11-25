import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import worker from '../cloud/worker.mjs';

const secret = () => randomBytes(32).toString('base64url');
const owner = secret();
const ownerAuth = 'Bearer ' + owner;
const ip = '192.0.2.1';
const email = 'student@example.test';

function fixture(t, option = {}) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const execute = sql => {
    const bind = (...args) => ({
      run: async () => ({ meta: sqlite.prepare(sql).run(...args) }),
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      first: async () => sqlite.prepare(sql).get(...args),
    });
    return { ...bind(), bind };
  };
  const allow = { limit: async () => ({ success: true }) };
  const env = {
    QUM_OWNER_KEY: owner, QUM_MAX_STUDENTS: '1',
    STUDENT_RATE: allow, SUGGESTION_RATE: allow, SUGGESTION_IP_RATE: allow,
    DB: {
      prepare: execute,
      async batch(statements) {
        sqlite.exec('BEGIN');
        try {
          for (const item of statements) await item.run();
          sqlite.exec('COMMIT');
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
    },
    ...option,
  };
  return async (authorization, op, data = {}, binary) => {
    const request = new Request('https://example.test/v1/classroom', {
      method: 'POST', headers: { Authorization: authorization, 'CF-Connecting-IP': ip, ...binary?.headers },
      body: binary?.body ?? JSON.stringify({ op, ...data }),
    });
    const result = await worker.fetch(request, env);
    return { status: result.status, body: result.headers.get('Content-Type') === 'application/octet-stream'
      ? await result.text() : await result.json() };
  };
}

test('Cloudflare requires owner-issued enrollment, binds it to one device, and enforces capacity', async t => {
  const call = fixture(t);
  assert.equal((await call(ownerAuth, 'publish', { title: 'الصف', body: 'موعد الدرس' })).status, 200);
  const device = secret();
  const deviceAuth = 'Device ' + device;
  assert.equal((await call(deviceAuth, 'sync')).status, 401);
  assert.equal((await call(deviceAuth, 'create-invite', { name: 'طالب', email })).status, 400);
  const [one, two] = await Promise.all([
    call(ownerAuth, 'create-invite', { name: 'طالب', email }),
    call(ownerAuth, 'create-invite', { name: 'طالب آخر', email }),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  const invite = 'Invite ' + (one.body.invite || two.body.invite);
  assert.equal((await call(invite, 'register', { device, email })).status, 200);
  assert.equal((await call(invite, 'register', { device, email })).status, 200);
  assert.equal((await call(invite, 'register', { device: secret(), email })).status, 401);
  assert.equal((await call(invite, 'sync')).status, 401);
  assert.equal((await call(deviceAuth, 'sync', { device: secret() })).status, 401);
  assert.equal((await call(invite, 'register', { device, email: 'other@example.test' })).status, 401);
  assert.deepEqual((await call(deviceAuth, 'sync')).body.notices.map(item => item.title), ['الصف']);
  const requestId = secret();
  const suggestion = await call(deviceAuth, 'suggest', { requestId, body: 'اقتراح' });
  assert.equal(suggestion.status, 200);
  assert.equal((await call(deviceAuth, 'suggest', { requestId, body: 'اقتراح' })).body.entries.length, 1);
  assert.equal((await call(ownerAuth, 'reply', { id: suggestion.body.entries[0].id, body: 'رد' })).status, 200);
  assert.equal((await call(deviceAuth, 'sync')).body.entries[0].reply, 'رد');
  const photo = { image: 'data:image/jpeg;base64,/9j/AA==', title: 'درس', subject: 'علوم', requestId: secret() };
  assert.equal((await call(deviceAuth, 'addsource', photo)).body.pending, true);
  assert.equal((await call(deviceAuth, 'sources', { subject: photo.subject })).body.entries[0].approved, 0);
  const page = await call(ownerAuth, 'sources');
  const { id } = page.body.entries[0];
  assert.equal((await call(deviceAuth, 'source', { id })).status, 200);
  assert.equal((await call(ownerAuth, 'approvesource', { id })).status, 200);
  assert.equal((await call(deviceAuth, 'source', { id })).body.entry.image, photo.image);
  assert.equal((await call(ownerAuth, 'blockemail', { email })).status, 200);
  assert.equal((await call(deviceAuth, 'sync')).status, 403);
  assert.equal((await call(ownerAuth, 'unblockemail', { email })).status, 200);
  assert.equal((await call(ownerAuth, 'registrations')).body.total, 1);
});

test('Cloudflare applies network and device limits to authenticated suggestions', async t => {
  const limited = [];
  let allowNetwork = false;
  const call = fixture(t, {
    STUDENT_RATE: { limit: async ({ key }) => {
      assert.equal(key, ip);
      return { success: allowNetwork };
    } },
    SUGGESTION_RATE: { limit: async ({ key }) => { limited.push(key); return { success: true }; } },
    SUGGESTION_IP_RATE: { limit: async ({ key }) => { limited.push(key); return { success: false }; } },
  });
  const { body: { invite } } = await call(ownerAuth, 'create-invite', { name: 'طالب', email });
  const device = secret();
  assert.equal((await call('Invite ' + invite, 'register', { device, email })).status, 429);
  allowNetwork = true;
  assert.equal((await call('Invite ' + invite, 'register', { device, email })).status, 200);
  assert.equal((await call('Device ' + device, 'suggest', { requestId: secret(), body: 'اقتراح' })).status, 429);
  assert.match(limited[0], /^student:[a-f0-9]{64}$/);
  assert.equal(limited[1], ip);
  assert.deepEqual((await call(ownerAuth, 'feedback')).body.entries, []);
});

test('the owner invitation page requires the expected Access application and owner identity', async () => {
  const { ownerPage } = await import('../cloud/owner.mjs');
  const url = 'https://school.example.test/owner';
  const env = { QUM_ACCESS_AUD: 'owner-app', QUM_ACCESS_OWNER_EMAIL: 'owner@example.test', QUM_OWNER_KEY: owner };
  let sent;
  const handle = async (auth, data) => { sent = { auth, data }; return { invite: 'example-invite' }; };
  const context = (aud, email) => ({ access: { aud, getIdentity: async () => ({ email }) } });
  assert.equal((await ownerPage(new Request(url), env, {}, handle)).status, 403);
  assert.equal((await ownerPage(new Request(url), env, context('other-app', env.QUM_ACCESS_OWNER_EMAIL), handle)).status, 403);
  assert.equal((await ownerPage(new Request(url), env, context(env.QUM_ACCESS_AUD, 'student@example.test'), handle)).status, 403);
  const ctx = context(env.QUM_ACCESS_AUD, env.QUM_ACCESS_OWNER_EMAIL);
  assert.equal((await ownerPage(new Request(url), env, ctx, handle)).status, 200);
  const post = origin => new Request(url, {
    method: 'POST', headers: { Origin: origin },
    body: new URLSearchParams({ op: 'create-invite', name: 'طالب', email }),
  });
  assert.equal((await ownerPage(post('https://other.example.test'), env, ctx, handle)).status, 403);
  const created = await ownerPage(post('https://school.example.test'), env, ctx, handle);
  assert.equal(created.status, 200);
  assert.match(await created.text(), /example-invite/);
  assert.equal(sent.auth, ownerAuth);
  assert.equal(sent.data.op, 'create-invite');
});

test('students joining later can browse published history and only manage their own sources', async t => {
  const call = fixture(t, { QUM_MAX_STUDENTS: '3' });
  async function join(address) {
    const invite = await call(ownerAuth, 'create-invite', { name: 'طالب', email: address });
    const device = secret();
    assert.equal(invite.status, 200);
    assert.equal((await call('Invite ' + invite.body.invite, 'register', { email: address, device })).status, 200);
    return 'Device ' + device;
  }
  const author = await join('author@example.test');
  const subject = 'مادة قديمة بلا تسجيل في فهرس المواد';
  const file = { name: 'lesson.pdf', base64: 'SGVsbG8=' };
  assert.equal((await call(author, 'addsource', { subject, title: 'الملف القديم', file, requestId: secret() })).status, 200);
  const oldest = (await call(ownerAuth, 'sources', { files: true })).body.entries[0].id;
  assert.equal((await call(ownerAuth, 'approvesource', { id: oldest })).status, 200);
  for (let i = 0; i < 20; i++) {
    assert.equal((await call(ownerAuth, 'addsource', { subject, title: 'لاحق ' + i, file, requestId: secret() })).status, 200);
  }
  assert.equal((await call(author, 'addsource', { subject, title: 'خاص حتى الاعتماد', file, requestId: secret() })).status, 200);
  const pending = (await call(author, 'sources', { subject, files: true })).body.entries[0].id;
  const newcomer = await join('newcomer@example.test');
  assert.deepEqual((await call(newcomer, 'subjects')).body.subjects, [{ name: subject, docs: 21 }]);
  const firstPage = (await call(newcomer, 'sources', { subject, files: true })).body;
  assert.equal(firstPage.entries.length, 20);
  assert.deepEqual((await call(newcomer, 'sources', { subject, files: true, before: firstPage.next })).body.entries.map(item => item.id), [oldest]);
  assert.equal((await call(newcomer, 'source', { id: oldest })).body.entry.file.name, 'lesson.pdf');
  assert.equal((await call(newcomer, 'source', { id: pending })).status, 404);
  assert.equal((await call(newcomer, 'renamesource', { id: oldest, title: 'عنوان بديل' })).status, 404);
  assert.equal((await call(newcomer, 'removesource', { id: oldest })).status, 403);
  assert.equal((await call(author, 'renamesource', { id: oldest, title: 'العنوان المصحّح' })).status, 200);
  assert.equal((await call(newcomer, 'source', { id: oldest })).body.entry.title, 'العنوان المصحّح');
  assert.equal((await call(ownerAuth, 'renamesource', { id: oldest, title: 'عنوان المالك' })).status, 200);
});

test('students upload more than ten sources without using the suggestion allowance', async t => {
  const call = fixture(t, { SUGGESTION_RATE: { limit: async () => ({ success: false }) } });
  const { body: { invite } } = await call(ownerAuth, 'create-invite', { name: 'طالب', email });
  const device = secret();
  assert.equal((await call('Invite ' + invite, 'register', { device, email })).status, 200);
  for (let i = 0; i < 12; i++) {
    const result = await call('Device ' + device, 'addsource', {
      requestId: secret(), title: 'درس ' + i, subject: 'علوم', image: 'data:image/jpeg;base64,/9j/AA==',
    });
    assert.deepEqual(result, { status: 200, body: { pending: true } });
  }
  assert.equal((await call(ownerAuth, 'sources')).body.entries.length, 12);
});

test('multipart sources enforce file size, retry safely and require classroom access to download', async t => {
  const objects = new Map();
  let uploaded = new Map();
  const call = fixture(t, { SOURCE_FILES: {
    async createMultipartUpload() { uploaded = new Map(); return { uploadId: secret() }; },
    resumeMultipartUpload(key) {
      return {
        async uploadPart(partNumber, bytes) {
          uploaded.set(partNumber, bytes.byteLength);
          return { partNumber, etag: String(partNumber) };
        },
        async complete(parts) {
          assert.equal(parts.length, uploaded.size);
          const object = { size: [...uploaded.values()].reduce((sum, bytes) => sum + bytes, 0) };
          objects.set(key, object);
          return object;
        },
      };
    },
    async head(key) { return objects.get(key); },
    async get(key) { return objects.has(key) ? { size: objects.get(key).size, body: 'contents' } : null; },
    async delete(key) { objects.delete(key); },
  } });
  const { body: { invite } } = await call(ownerAuth, 'create-invite', { name: 'طالب', email });
  const device = secret();
  const student = 'Device ' + device;
  assert.equal((await call('Invite ' + invite, 'register', { device, email })).status, 200);
  const details = { name: 'lesson.pdf', title: 'درس', subject: 'علوم', requestId: secret() };
  assert.equal((await call(student, 'startsource', { ...details, size: 600_000_001 })).status, 413);
  const { status, body: { upload, partSize } } = await call(student, 'startsource', { ...details, size: 600_000_000 });
  assert.equal(status, 200);
  const sendPart = (auth, number, body, token = upload) => call(auth, 'sourcepart', {}, {
    headers: { 'X-Source-Upload': token, 'X-Source-Part': String(number), 'Content-Length': String(body.length) }, body,
  });
  const buffer = new Uint8Array(partSize);
  assert.equal((await sendPart(ownerAuth, 1, buffer)).status, 400);
  assert.equal((await sendPart(student, 1, buffer.subarray(0, 1))).status, 400);
  const parts = [];
  for (let number = 1, remaining = 600_000_000; remaining > 0; number++) {
    const bytes = buffer.subarray(0, Math.min(partSize, remaining));
    const part = await sendPart(student, number, bytes);
    assert.equal(part.status, 200);
    parts.push(part.body);
    remaining -= bytes.length;
  }
  const finalize = () => call(student, 'finishsource', { upload, parts });
  assert.equal((await finalize()).status, 200);
  assert.equal((await finalize()).status, 200);
  assert.deepEqual((await call(student, 'startsource', { ...details, size: 600_000_000 })).body, { saved: true });
  const { body: { entries } } = await call(ownerAuth, 'sources', { files: true });
  assert.equal(entries.length, 1);
  const { id } = entries[0];
  assert.deepEqual((await call(student, 'source', { id })).body.entry.file, { name: details.name, size: 600_000_000 });
  assert.equal((await call('Device ' + secret(), 'downloadsource', { id })).status, 401);
  assert.deepEqual(await call(student, 'downloadsource', { id }), { status: 200, body: 'contents' });
  assert.equal((await call(student, 'removesource', { id })).status, 200);
  assert.equal(objects.size, 0);
});
