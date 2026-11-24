import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { classroom } from './classroom.mjs';

const owner = process.env.QUM_OWNER_KEY || '';
const invite = process.env.QUM_STUDENT_KEY || '';
if (owner.length < 32 || invite.length < 24 || owner === invite) throw Error('Set distinct QUM_OWNER_KEY and QUM_STUDENT_KEY.');
const location = process.env.QUM_DATABASE || 'data/qum-cloud.sqlite';
mkdirSync(dirname(location), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(location);
db.exec('PRAGMA journal_mode=WAL;');
db.exec(readFileSync(new URL('./migrations/0001_classroom.sql', import.meta.url), 'utf8'));
const handle = classroom(db, owner, invite, async () => {}, async () => {}, process.env.QUM_OWNER_DEVICE_HASH);
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
async function readPayload(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1450000) fail(413, 'الطلب كبير جدًا.');
    chunks.push(chunk);
  }
  let data;
  try { data=JSON.parse(Buffer.concat(chunks)); }
  catch { fail(400, 'صيغة الطلب غير صالحة.'); }
  if(data?.op!=='addsource' && size>32768)fail(413,'الطلب كبير جدًا.');
  return data;
}
const server = createServer({ requestTimeout: 15000, headersTimeout: 8000 }, async (request, response) => {
  const send = (status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  };
  try {
    if (request.method !== 'POST' || request.url !== '/v1/classroom') fail(404, 'المسار غير موجود.');
    const data = await readPayload(request);
    if (!data || typeof data !== 'object') fail(400, 'صيغة الطلب غير صالحة.');
    send(200, await handle(request.headers.authorization || '', data));
  } catch (error) {
    send(error.status || 500, { error: error.status ? error.message : 'تعذّر تنفيذ الطلب على خادم الصف.' });
  }
});
server.listen(Number(process.env.QUM_PORT || 8080), process.env.QUM_BIND || '127.0.0.1', () => {
  console.log('Classroom listening on ' + server.address().port);
});
