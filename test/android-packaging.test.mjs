import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
    assert.match(source, /android:versionCode="13"/);
    assert.match(source, /android:versionName="0\.7\.0"/);
    assert.match(source, /android:usesCleartextTraffic="false"/);
    assert.doesNotMatch(source, /android.intent.category.BROWSABLE/);
  }
  for (const path of ['web', 'deploy', 'server.mjs', 'lib']) {
    assert.equal(existsSync(new URL('../' + path, import.meta.url)), false);
  }
  assert.doesNotMatch(read('android/build.sh'), /student-origin\.txt|web\/fonts/);
  assert.doesNotMatch(read('android/src/school/dafaa/MainActivity.java'), /openStudentApp|httpsOrigin/);
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
