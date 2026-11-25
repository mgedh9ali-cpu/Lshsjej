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
  return async (authorization, op, data = {}) => {
    const request = new Request('https://example.test/v1/classroom', {
      method: 'POST', headers: { Authorization: authorization, 'CF-Connecting-IP': ip },
      body: JSON.stringify({ op, ...data }),
    });
    const result = await worker.fetch(request, env);
    return { status: result.status, body: await result.json() };
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
  assert.deepEqual((await call(deviceAuth, 'sources', { subject: photo.subject })).body.entries, []);
  const page = await call(ownerAuth, 'sources');
  const { id } = page.body.entries[0];
  assert.equal((await call(deviceAuth, 'source', { id })).status, 404);
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
