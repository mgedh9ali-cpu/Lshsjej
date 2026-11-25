import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}
test('separate interfaces, owner approvals, private results, notices and image deduplication', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'school-test-'));
  const password = 'temporary-password';
  const source = join(tmp, 'test.sqlite');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z1sAAAAASUVORK5CYII=';
  const legacyBytes = Buffer.from(png.split(',')[1], 'base64');
  const legacy = new DatabaseSync(source);
  legacy.exec(`
    CREATE TABLE subject_images(id INTEGER PRIMARY KEY, subject INTEGER NOT NULL, day TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, mime TEXT, content BLOB, UNIQUE(subject, day, number));
    CREATE TABLE submissions(id INTEGER PRIMARY KEY,user INTEGER,subject INTEGER,digest TEXT,state TEXT,document INTEGER);
  `);
  legacy.prepare("INSERT INTO subject_images VALUES(200,1,'2026-11-01',1,'Legacy image','image/png',?)").run(legacyBytes);
  legacy.prepare("INSERT INTO submissions VALUES(200,999,1,?,'published',NULL)").run(createHash('sha256').update(legacyBytes).digest('hex'));
  legacy.close();
  let aiCalls = 0;
  const mock = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const candidates = JSON.parse(input.messages[1].content[0].text);
    aiCalls++;
    const result = { title: candidates.length ? 'شرح قانون أوم' : 'قانون أوم', body: 'فرق الجهد = التيار × المقاومة', duplicateId: candidates[0]?.id ?? null, readable: true };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  }).listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const studentPort = await freePort();
  let adminPort = await freePort();
  while (adminPort === studentPort) adminPort = await freePort();
  const server = spawn(process.execPath, ['server.mjs'], { env: {
    ...process.env, SCHOOL_DB: source, OWNER_USERNAME: 'owner', OWNER_PASSWORD: password,
    OWNER_TOTP_HEX: '', SCHOOL_SECURE: '0', SCHOOL_HOST: '127.0.0.1', STUDENT_PORT: String(studentPort), ADMIN_PORT: String(adminPort),
    SCHOOL_AI_URL: 'http://127.0.0.1:' + mock.address().port, SCHOOL_AI_KEY: 'mock', SCHOOL_AI_MODEL: 'mock',
  }, stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(server, 'exit');
  t.after(async () => {
    server.kill();
    await exited;
    mock.close();
    await rm(tmp, { recursive: true, force: true });
  });
  let logs = '';
  while (!logs.includes('admin listening') || !logs.includes('student listening')) {
    const [data] = await Promise.race([once(server.stdout, 'data'), exited.then(() => { throw Error('Server exited'); })]);
    logs += data;
  }
  for (const [port, title] of [[studentPort, 'قوم دروس'], [adminPort, 'لوحة إدارة قوم دروس']]) {
    const response = await fetch('http://127.0.0.1:' + port + '/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp('<title>' + title + '</title>'));
    for (const asset of ['/styles.css', '/app.js', '/common.js']) {
      const file = await fetch('http://127.0.0.1:' + port + asset);
      assert.equal(file.status, 200);
      assert.ok((await file.text()).length > 0);
      const conditional = await fetch('http://127.0.0.1:' + port + asset, { headers: { 'If-None-Match': file.headers.get('ETag') } });
      assert.equal(conditional.status, 304);
    }
  }
  assert.equal(await (await fetch('http://127.0.0.1:' + studentPort + '/student-app')).text(), 'school-student-v1');
  assert.equal((await fetch('http://127.0.0.1:' + adminPort + '/student-app')).status, 404);
  const request = async (port, path, data, session) => {
    const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(session && { Cookie: session }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  };
  const admin = (path, data, cookie = owner.cookie) => request(adminPort, path, data, cookie);
  const student = (path, data, cookie = learner.cookie) => request(studentPort, path, data, cookie);
  const owner = await request(adminPort, '/login', { username: 'owner', password });
  assert.equal(owner.status, 200);
  assert.equal((await request(studentPort, '/login', { username: 'owner', password })).status, 401);
  assert.equal((await admin('/accounts', { accounts: [{ name: 'طالب', username: 'student1', password }, { name: 'طالب آخر', username: 'student2', password }] })).status, 200);
  assert.equal((await admin('/accounts', { name: 'مساعد', username: 'assistant', password, role: 'assistant', permissions: ['quizzes'] })).status, 200);
  const assistant = await request(adminPort, '/login', { username: 'assistant', password });
  assert.equal((await admin('/password', { password: 'revised-assistant-key' }, assistant.cookie)).status, 200);
  const learner = await request(studentPort, '/login', { name: 'طالب', password });
  assert.equal((await admin('/me', undefined, learner.cookie)).status, 401);
  assert.equal((await student('/subjects')).status, 403);
  assert.equal((await student('/password', { password: 'revised-student-key' })).status, 200);
  assert.equal((await student('/suggestions', { body: 'أضفوا تمارين للمراجعة' })).status, 200);
  assert.equal((await student('/suggestions')).status, 404);
  assert.equal((await admin('/suggestions', undefined, assistant.cookie)).status, 403);
  assert.equal((await admin('/suggestions')).body[0].body, 'أضفوا تمارين للمراجعة');
  const entry = (await student('/my-suggestions')).body[0];
  assert.equal(entry.reply, null);
  assert.equal((await admin('/reply-suggestion', {id:entry.id,body:'تمت المراجعة'}, assistant.cookie)).status, 403);
  assert.equal((await admin('/reply-suggestion', {id:entry.id,body:'تمت المراجعة'})).status, 200);
  assert.equal((await student('/my-suggestions')).body[0].reply, 'تمت المراجعة');
  const subjects = (await student('/subjects')).body;
  assert.equal(subjects.length, 5);
  const subject = subjects[0].id;
  assert.equal((await admin('/quizzes', { title: 'اختبار', subject, questions: [{ text: 'هل هذا صحيح؟', options: ['صح', 'خطأ'], correct: 0 }] }, assistant.cookie)).status, 200);
  const id = (await admin('/quizzes')).body[0].id;
  assert.equal((await admin('/publish-quiz', { id }, assistant.cookie)).status, 403);
  assert.deepEqual((await student('/quizzes?subject=' + subject)).body, []);
  assert.equal((await admin('/publish-quiz', { id })).status, 200);
  assert.equal('correct' in (await student('/quiz?id=' + id)).body.questions[0], false);
  assert.equal((await student('/quiz', { id, answers: [0] })).body.score, 1);
  assert.equal((await student('/quiz', { id, answers: [0] })).status, 409);
  assert.equal((await student('/quiz?id=' + id)).body.attempted, true);
  assert.equal((await student('/results')).body.length, 1);
  const second = await request(studentPort, '/login', { username: 'student2', password });
  await student('/password', { password: 'another-student-key' }, second.cookie);
  assert.deepEqual((await student('/results', undefined, second.cookie)).body, []);
  assert.deepEqual((await student('/my-suggestions', undefined, second.cookie)).body, []);
  await admin('/notices', { kind: 'reminder', title: 'لاحقًا', body: 'مراجعة', subject, publish: true, visible: new Date(Date.now() + 86400000).toISOString() });
  await admin('/notices', { kind: 'reminder', title: 'اليوم', body: 'اختبار', subject, publish: true });
  assert.deepEqual((await student('/notices')).body.map(item => item.title), ['اليوم']);
  const imageUrl = 'http://127.0.0.1:' + studentPort + '/archive-image?id=';
  assert.equal((await fetch(imageUrl + '200', { headers: { Cookie: learner.cookie } })).status, 404);
  assert.equal((await fetch('http://127.0.0.1:' + adminPort + '/archive-image?id=200', { headers: { Cookie: owner.cookie } })).status, 200);
  const contribution = 'data:image/png;base64,' + Buffer.concat([legacyBytes, Buffer.from([0])]).toString('base64');
  const first = await student('/submissions', { subject, image: contribution });
  assert.equal(first.status, 200);
  async function completed(id) {
    for (let i = 0; i < 100; i++) {
      const item = (await student('/submissions?subject=' + subject)).body.find(row => row.id === id);
      if (item.state !== 'processing') return item;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('Image processing timeout');
  }
  const pending = await completed(first.body.id);
  assert.equal(pending.state, 'review');
  assert.deepEqual((await student('/documents?subject=' + subject)).body, []);
  assert.equal((await admin('/submission-review', undefined, assistant.cookie)).status, 403);
  const [{ title, body }] = (await admin('/submission-review')).body;
  assert.equal((await admin('/submission-review', { id: pending.id, action: 'approve', title, body })).status, 200);
  const published = await completed(first.body.id);
  assert.equal(published.state, 'published');
  assert.equal((await student('/submissions', { subject, image: contribution })).body.state, 'duplicate');
  const webp = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  const semantic = await student('/submissions', { subject, image: webp });
  assert.equal((await completed(semantic.body.id)).document, published.document);
  assert.equal(aiCalls, 2);
  assert.equal((await student('/documents?subject=' + subject)).body.length, 1);
  const archiveUrl = '/archive?subject=' + subject;
  const initialArchive = (await student(archiveUrl)).body;
  assert.equal(initialArchive.images.length, 0);
  assert.equal(initialArchive.documents.length, 1);
  assert.equal((await student('/progress', { subject, page: 57 })).status, 404);
  assert.equal((await admin('/progress', { subject, page: 53 })).status, 200);
  assert.equal((await admin('/progress', { subject, page: 57 })).status, 200);
  assert.equal((await student(archiveUrl)).body.page, 57);
  const photo = { subject, title: 'نشاط', day: '2026-11-22', image: png };
  assert.equal((await admin('/archive-image', { ...photo, day: '2026-02-30' })).status, 400);
  const manual = (await admin('/archive-image', photo)).body.id;
  assert.equal((await admin('/archive-image-remove', { id: manual })).status, 200);
  const later = (await admin('/archive-image', photo)).body.id;
  const dated = (await student(archiveUrl)).body.images.filter(item => item.day === photo.day && item.id === later);
  assert.equal(dated[0].number, 2);
  assert.equal((await fetch(imageUrl + later)).status, 401);
  assert.equal((await fetch(imageUrl + manual, { headers: { Cookie: learner.cookie } })).status, 404);
  const visibleImage = await fetch(imageUrl + later, { headers: { Cookie: learner.cookie } });
  assert.equal(visibleImage.headers.get('Content-Type'), 'image/png');
  assert.equal((await visibleImage.arrayBuffer()).byteLength, Buffer.from(png.split(',')[1], 'base64').length);

  const group = Array.from({ length: 30 }, (_, index) => ({ username: 'load' + index, name: 'طالب ' + index, password }));
  assert.equal((await admin('/accounts', { accounts: group })).status, 200);
  const start = performance.now();
  const sessions = await Promise.all(group.map(account => request(studentPort, '/login', account)));
  assert.ok(sessions.every(session => session.status === 200 && session.cookie));
  const profiles = await Promise.all(sessions.map(session => student('/me', undefined, session.cookie)));
  assert.ok(profiles.every((profile, index) => profile.body.username === group[index].username));
  t.diagnostic('30 concurrent logins + 30 profile requests: ' + Math.round(performance.now() - start) + ' ms');
  const backup = join(tmp, 'restore.sqlite');
  const copied = spawnSync(process.execPath, ['scripts/backup.mjs', backup], { env: { ...process.env, SCHOOL_DB: source } });
  assert.equal(copied.status, 0, copied.stderr.toString());
  const restored = new DatabaseSync(backup, { readOnly: true });
  try {
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(restored.prepare("SELECT count(*) AS total FROM users WHERE role='student'").get().total, 32);
    assert.equal(restored.prepare('SELECT count(*) AS total FROM documents').get().total, 1);
    assert.equal(restored.prepare('SELECT count(*) AS total FROM attempts').get().total, 1);
  } finally { restored.close(); }
  assert.equal((await student('/submissions', { subject, image: contribution })).status, 200);
  assert.equal((await student('/submissions', { subject, image: contribution })).status, 200);
  assert.equal((await student('/submissions', { subject, image: contribution })).status, 429);
  assert.equal((await admin('/document-remove', { id: published.document })).status, 200);
  assert.deepEqual((await student('/documents?subject=' + subject)).body, []);
  assert.equal((await completed(first.body.id)).state, 'withdrawn');
  const generated = await admin('/accounts', { name: 'طالب إضافي', username: 'generated' });
  assert.equal(generated.status, 200);
  assert.equal(generated.body[0].password.split(' ').length, 4);
  assert.equal((await request(studentPort, '/login', generated.body[0])).status, 200);
  const newOwnerPassword = 'new-owner-password';
  const rotation = spawnSync(process.execPath, ['scripts/reset-owner-password.mjs'], {
    input: newOwnerPassword + '\n', env: { ...process.env, SCHOOL_DB: source },
  });
  assert.equal(rotation.status, 0, rotation.stderr.toString());
  assert.equal((await admin('/me')).status, 401);
  assert.equal((await request(adminPort, '/login', { username: 'owner', password })).status, 401);
  assert.equal((await request(adminPort, '/login', { username: 'owner', password: newOwnerPassword })).status, 200);
});
