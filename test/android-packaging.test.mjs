import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('ships separate student and owner launchers without the hosted web app', () => {
  for (const [manifest, id, activity] of [
    ['AndroidManifest.xml', 'school.dafaa', '.RoomActivity'],
    ['OwnerManifest.xml', 'school.dafaa.owner', 'school.dafaa.RoomActivity'],
  ]) {
    const source = read('android/' + manifest);
    assert.ok(source.includes('package="' + id + '"'));
    assert.ok(source.includes('android:name="' + activity + '"'));
    assert.match(source, /android:versionCode="22"/);
    assert.match(source, /android:versionName="0\.7\.9"/);
    assert.match(source, /android:usesCleartextTraffic="false"/);
    assert.doesNotMatch(source, /android.intent.category.BROWSABLE/);
  }
  for (const path of ['web', 'deploy', 'server.mjs', 'lib']) {
    assert.equal(existsSync(new URL('../' + path, import.meta.url)), false);
  }
  assert.doesNotMatch(read('android/build.sh'), /student-origin\.txt|web\/fonts/);
  assert.equal(existsSync(new URL('../android/src/school/dafaa/MainActivity.java', import.meta.url)), false);
});

test('the student password stays local and classroom traffic uses HTTPS', () => {
  const script = read('android/room/room.js');
  assert.match(script, /rpc\(hasAccount\?'unlock':'register',data\)/);
  assert.doesNotMatch(script, /شبكة الواي فاي/);
  const bridge = read('android/src/school/dafaa/RoomActivity.java');
  assert.match(bridge, /put\("device",device\)\.put\("name",localData\(\)\.getString\("name",""\)\)/);
  assert.match(bridge, /note_\s*"\+index/);
  assert.match(bridge, /putString\("outbox",queue\.toString\(\)\)\.commit\(\)/);
  assert.match(read('android/src/school/dafaa/CloudClass.java'), /HttpsURLConnection/);
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
      owner ? ['home', 'feed', 'feedback', 'accounts', 'settings'] : ['home', 'feed', 'feedback', 'settings']);
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
  const end = script.indexOf('async function feed()', start);
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

test('source images are published without text extraction', () => {
  assert.match(read('android/room/room.js'), /rpc\('addSource',\{subject:subject.id,title,image\}\)/);
  assert.doesNotMatch(read('android/build.sh'), /prepare-ocr|offline\/\*/);
});
