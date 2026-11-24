import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('the owner and students exchange durable updates between separate sessions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qum-cloud-'));
  const secret = () => randomBytes(32).toString('hex');
  const owner = secret(), invite = secret();
  let child;
  async function launch() {
    child = spawn(process.execPath, ['cloud/server.mjs'], { env: {
      ...process.env, QUM_PORT: '0', QUM_DATABASE: join(dir, 'cloud.sqlite'),
      QUM_OWNER_KEY: owner, QUM_STUDENT_KEY: invite,
    }, stdio: ['ignore', 'pipe', 'inherit'] });
    const [output] = await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(() => { throw Error('Cloud server exited.'); }),
    ]);
    return 'http://127.0.0.1:' + /listening on (\d+)/.exec(output.toString())[1];
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  let origin = await launch();
  async function call(key, data, status = 200) {
    const reply = await fetch(origin + '/v1/classroom', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify(data),
    });
    assert.equal(reply.status, status);
    return reply.json();
  }
  const student = { name: 'طالب أول', email: 'first@example.com', device: secret() };
  const other = { name: 'طالب ثانٍ', email: 'second@example.com', device: secret() };
  const requestId = secret();
  await call(invite, { ...student, op: 'publish' }, 400);
  await call('wrong key', { op: 'notices' }, 401);
  await call(invite, { ...student, op: 'register' });
  await call(owner, { op: 'publish', title: 'موعد الحصة', body: 'غدًا' });
  const suggestion = { ...student, op: 'suggest', body: 'أضيفوا أسئلة', requestId };
  await call(invite, suggestion);
  await call(invite, suggestion);
  const { entries } = await call(owner, { op: 'feedback' });
  assert.equal(entries.length, 1);
  await call(owner, { op: 'reply', id: entries[0].id, body: 'تمت الإضافة' });
  await stop();
  origin = await launch();
  const synced = await call(invite, { ...student, op: 'sync' });
  assert.equal(synced.notices[0].title, 'موعد الحصة');
  assert.equal(synced.entries[0].reply, 'تمت الإضافة');
  await call(invite, { ...other, op: 'register' });
  assert.deepEqual((await call(invite, { ...other, op: 'sync' })).entries, []);
  assert.equal((await call(owner, { op: 'registrations' })).total, 2);
  await call(owner, { op: 'blockemail', email: student.email });
  await stop();
  origin = await launch();
  await call(invite, { ...student, op: 'sync' }, 403);
  await call(invite, { op: 'register', name: student.name, device: secret(), email: 'FIRST@example.com' }, 403);
  await call(owner, { op: 'unblockemail', email: student.email });
  assert.equal((await call(invite, { ...student, op: 'sync' })).entries.length, 1);
});
