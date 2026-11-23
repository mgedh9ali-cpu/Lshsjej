import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('ships separate student and owner launchers without the hosted web app', () => {
  for (const [manifest, id, activity] of [
    ['AndroidManifest.xml', 'school.dafaa', '.MainActivity'],
    ['OwnerManifest.xml', 'school.dafaa.owner', 'school.dafaa.RoomActivity'],
  ]) {
    const source = read('android/' + manifest);
    assert.ok(source.includes('package="' + id + '"'));
    assert.ok(source.includes('android:name="' + activity + '"'));
    assert.match(source, /android:versionCode="16"/);
    assert.match(source, /android:versionName="0\.7\.3"/);
    assert.match(source, /android:usesCleartextTraffic="false"/);
    assert.doesNotMatch(source, /android.intent.category.BROWSABLE/);
  }
  for (const path of ['web', 'deploy', 'server.mjs', 'lib']) {
    assert.equal(existsSync(new URL('../' + path, import.meta.url)), false);
  }
  assert.doesNotMatch(read('android/build.sh'), /student-origin\.txt|web\/fonts/);
  assert.doesNotMatch(read('android/src/school/dafaa/MainActivity.java'), /openStudentApp|httpsOrigin/);
});

test('student registration is local and only the registration notice is sent to the owner', () => {
  const interfaceCode = read('android/room/room.js');
  assert.doesNotMatch(interfaceCode, /go\('pair'\)|رمز الربط|مشاركة الرمز/);
  assert.match(interfaceCode, /rpc\(hasAccount\?'unlock':'register',data\)/);
  assert.match(interfaceCode, /تم التسجيل · /);
  const registration = read('android/src/school/dafaa/LocalRegistration.java');
  assert.match(registration, /RoomStore\.obj\("op", "registerLocal", "id", id, "name", name\)/);
  assert.doesNotMatch(registration, /password|verifier|salt/);
  assert.match(registration, /RoomStore\.obj\("op", "localNotices", "id", id\)/);
  assert.match(read('android/src/school/dafaa/RoomStore.java'), /SELECT id,title,body,created FROM posts ORDER BY id DESC/);
});

test('the bottom bar opens role-specific pages and keeps Materials selected inside a lesson', () => {
  const html = read('android/room/room.html');
  assert.match(html, /<nav id="bottom-nav"/);
  assert.doesNotMatch(html, /id="drawer"|id="menu"/);
  const script = read('android/room/room.js');
  const start = script.indexOf('const links=');
  const end = script.indexOf('async function boot()', start);
  const element = () => ({
    children: [],
    attrs: {},
    dataset: {},
    get childElementCount() { return this.children.length; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
    addEventListener() {},
  });
  for (const owner of [false, true]) {
    const nav = element();
    const activity = [];
    const globals = {
      owner, name: 'حساب تجريبي', locked: false, page: 'source', bottomNav: nav,
      document: { body: element(), documentElement: { classList: { toggle() {} } }, createElementNS: element },
      $: element, el: element,
      button: (_label, click) => Object.assign(element(), { click }),
      go: page => activity.push(page),
    };
    runInNewContext(script.slice(start, end) + '\nnavigation();', globals);
    assert.deepEqual(Array.from(nav.children, item => item.dataset.page),
      owner ? ['home', 'feed', 'feedback', 'accounts', 'settings'] : ['home', 'feed', 'settings']);
    assert.equal(nav.children[0].attrs['aria-current'], 'page');
    nav.children.at(-1).click();
    nav.children[1].click();
    assert.deepEqual(activity, ['settings','feed']);
    globals.name = '';
    runInNewContext('navigation();', globals);
    assert.equal(nav.hidden, true);
  }
});

test('the student inbox keeps received notices visible offline', async () => {
  const script = read('android/room/room.js');
  const start = script.indexOf('function noticeCards(');
  const end = script.indexOf('function feed()', start);
  const list = { isConnected: true, replaceChildren(...children) { this.children = children; } };
  const notice = { created: 0, title: 'موعد الدرس', body: 'الدرس غدًا' };
  const requests = [];
  const env = {
    $: () => list, window: {}, date: String, el: (_tag, text) => text,
    wrap: (_class, ...items) => items, online: true,
    rpc: async (op, options) => {
      requests.push([op, options.refresh]);
      return { notices: [notice], online: env.online };
    },
  };
  await runInNewContext(script.slice(start, end) + '\nrefreshStudentNotices(true);', env);
  assert.deepEqual(Array.from(list.children[0]), ['0', notice.title, notice.body]);
  env.online = false;
  await runInNewContext('refreshStudentNotices();', env);
  assert.match(list.children[0], /المحفوظة على الهاتف/);
  assert.deepEqual(Array.from(list.children[1]), ['0', notice.title, notice.body]);
  assert.deepEqual(requests, [['studentNotices', true], ['studentNotices', false]]);
});

test('the packaged offline catalog contains valid Arabic subject data', () => {
  const temp = mkdtempSync(join(tmpdir(), 'qum-catalog-'));
  try {
    const path = join(temp, 'catalog.sqlite');
    const run = spawnSync(process.execPath, ['scripts/build-student-db.mjs', path], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(db.prepare('SELECT count(*) AS total FROM subjects').get().total, 5);
      assert.equal(db.prepare('SELECT name FROM subjects WHERE id = 4').get().name, 'الرياضيات');
    } finally {
      db.close();
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
