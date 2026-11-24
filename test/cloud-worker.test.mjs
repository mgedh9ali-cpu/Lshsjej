import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
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
    STUDENT_RATE: { limit: async () => ({ success: true }) },
    SUGGESTION_RATE: { limit: async () => ({ success: true }) },
    DB: {
      batch: async statements => Promise.all(statements.map(statement => statement.run())),
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
    method: 'POST', headers: { Authorization: key.includes(' ') ? key : 'Bearer ' + key },
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
  assert.deepEqual(await owner({ op: 'reply', id: entries[0].id, body: 'تمّ.' }), {id:entries[0].id,reply:'تمّ.'});
  const synced = await learner({ op: 'sync', name: 'طالب', device });
  assert.equal(synced.entries[0].reply, 'تمّ.');
  assert.deepEqual((await learner({ op: 'sync', name: 'طالب آخر', device: secret() })).entries, []);
  await owner({op:'publish',title:'درس جديد',body:'راجِعوا المادة.'});
  const notices = await learner({op:'sync',name:'طالب',device});
  assert.equal(notices.notices[0].title, 'درس جديد');
  const publishingDevice = randomBytes(32).toString('base64url');
  const ownerDevice = randomBytes(32).toString('base64url');
  env.QUM_OWNER_DEVICE_HASH = createHash('sha256').update(ownerDevice).digest('base64url');
  const publication = { op: 'addsource', device: publishingDevice, name: 'طالبة', subject: 'الفيزياء',
    requestId: secret(), title: 'قانون نيوتن', image: 'data:image/jpeg;base64,/9j/AA==' };
  await send('Device ' + publishingDevice, publication);
  await send('Device ' + publishingDevice, publication);
  const {entries: sources} = await send('OwnerDevice ' + ownerDevice, {op:'sources'});
  assert.equal(sources.length, 1);
  assert.equal(sources[0].added_by, 'طالبة');
  const peer = randomBytes(32).toString('base64url');
  const peerData = {device:peer,name:'طالب آخر'};
  const anotherPeer = randomBytes(32).toString('base64url');
  for (const [device,name] of [[publishingDevice,'طالبة'],[peer,'طالب آخر'],[anotherPeer,'طالب جديد']]) {
    const auth = 'Device ' + device;
    const listing = await send(auth, {device,name,op:'sources',subject:'الفيزياء'});
    assert.equal(listing.entries[0].id,sources[0].id);
    assert.equal(Boolean(listing.entries[0].mine), device===publishingDevice);
    const photo = await send(auth, {device,name,op:'source',id:sources[0].id});
    assert.equal(photo.entry.image, publication.image);
    const chemistry = await send(auth, {device,name,op:'sources',subject:'الكيمياء'});
    assert.deepEqual(chemistry.entries, []);
  }
  await send('Device ' + peer, {...peerData,op:'removesource',id:sources[0].id}, 403);
  await send('OwnerDevice ' + ownerDevice, {op:'removesource',id:sources[0].id});
  await send('Device ' + peer, {...peerData,op:'source',id:sources[0].id}, 404);
  const registeredOwner='OwnerDevice '+ownerDevice;
  await send(registeredOwner,{op:'addsubject',name:'اللغة العربية'});
  assert.deepEqual((await send('Device '+peer,{...peerData,op:'subjects'})).subjects.map(s=>s.name),['اللغة العربية']);
  const studentAuth='Device '+publishingDevice;
  await send(studentAuth,{...publication,requestId:secret(),image:undefined,file:{name:'درس.txt',base64:'aGk='}});
  const files=(await send('Device '+peer,{...peerData,op:'sources',subject:'الفيزياء',files:true})).entries;
  const attached=files.find(entry=>entry.attachment);
  assert.ok(attached);
  assert.equal((await send('Device '+peer,{...peerData,op:'source',id:attached.id})).entry.file.name,'درس.txt');
  assert.ok((await send('Device '+peer,{...peerData,op:'sync'})).notices.some(n=>n.title==='طالبة نشر مصدرًا في الفيزياء'));
  await send(studentAuth,{...publication,op:'removesource',id:attached.id});
  await send('Device '+peer,{...peerData,op:'source',id:attached.id},404);
  for(const lesson of [
    {kind:'summary',title:'ملخص',body:'نص الملخص'},
    {kind:'link',title:'رابط اختبار',body:'https://example.org/quiz'},
    {kind:'quiz',title:'اختبار',question:'كم؟',choices:['١','٢'],answer:1}
  ])await send(registeredOwner,{...lesson,op:'addlesson',subject:'الفيزياء'});
  await send(registeredOwner,{op:'addlesson',kind:'link',subject:'الفيزياء',title:'رابط',body:'javascript:invalid'},400);
  const study=await send('Device '+peer,{...peerData,op:'study',subject:'الفيزياء'});
  assert.equal(study.entries.length,3);
  assert.equal(study.entries[0].answer,undefined);
  assert.equal((await send('Device '+peer,{...peerData,op:'solve',id:study.entries[0].id,choice:1})).correct,true);
  const report=await send('OwnerDevice '+ownerDevice,{op:'report'});
  assert.equal(typeof report.totals.sources,'number');
  await send('OwnerDevice '+randomBytes(32).toString('base64url'),{op:'report'},401);
  await send('Guest ',{op:'ownerlogin',password:secret()},401);
  const oversize = await worker.fetch(request(env.QUM_OWNER_KEY, { op: 'publish', body: 'x'.repeat(33000) }), env);
  assert.equal(oversize.status, 413);
});
