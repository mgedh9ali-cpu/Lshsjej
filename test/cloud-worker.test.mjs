import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../cloud/worker.mjs';

test('the Worker accepts the existing Android requests and isolates student replies', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../cloud/migrations/0001_classroom.sql', import.meta.url), 'utf8'));
  const secret = () => randomBytes(32).toString('hex');
  const env = {
    QUM_OWNER_KEY: secret(), QUM_STUDENT_KEY: secret(),
    DB: {
      prepare(sql) {
        const stmt = db.prepare(sql);
        function bind(...args) {
          return {
            bind,
            run: async () => ({ meta: { changes: stmt.run(...args).changes } }),
            all: async () => ({ results: stmt.all(...args) }),
            first: async () => stmt.get(...args) || null,
          };
        }
        return bind();
      },
    },
  };
  const request = (key, data) => new Request('https://class.example/v1/classroom', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key },
    body: JSON.stringify(data),
  });
  async function send(key, data, status = 200) {
    const response = await worker.fetch(request(key, data), env);
    assert.equal(response.status, status, await response.clone().text());
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
  }
  const owner = (data, status) => send(env.QUM_OWNER_KEY, data, status);
  const learner = (data, status) => send(env.QUM_STUDENT_KEY, data, status);
  const device = secret();
  const suggestion = { op: 'suggest', name: 'طالب', device, requestId: secret(), body: 'أضفوا تمرينًا.' };
  assert.equal((await worker.fetch(request(secret(), suggestion), {})).status, 503);
  await send(secret(), suggestion, 401);
  await learner(suggestion);
  await learner(suggestion);
  const { entries } = await owner({ op: 'feedback' });
  assert.equal(entries.length, 1);
  await learner({ op: 'feedback', name: 'طالب', device }, 400);
  await owner({ op: 'reply', id: entries[0].id, body: 'تمّ.' });
  const synced = await learner({ op: 'sync', name: 'طالب', device });
  assert.equal(synced.entries[0].reply, 'تمّ.');
  assert.deepEqual((await learner({ op: 'sync', name: 'طالب آخر', device: secret() })).entries, []);
  const oversize = await worker.fetch(request(env.QUM_OWNER_KEY, { op: 'publish', body: 'x'.repeat(33000) }), env);
  assert.equal(oversize.status, 413);
});
