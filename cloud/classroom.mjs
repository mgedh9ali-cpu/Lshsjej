import { createHash, timingSafeEqual } from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest();
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
function field(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, 'تحقق من البيانات المدخلة.');
  return value.trim();
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{32,64}$/.test(value)) fail(400, 'معرّف العملية غير صالح.');
  return value;
}
export const registrationSchema = [
  'CREATE TABLE IF NOT EXISTS student_emails (student TEXT PRIMARY KEY, email TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS student_emails_email ON student_emails(email)',
  'CREATE TABLE IF NOT EXISTS blocked_emails (email TEXT PRIMARY KEY)',
];
const blockedMessage = 'هذا البريد محظور من الصف.';
const allowedStudent = 'NOT EXISTS (SELECT 1 FROM blocked_emails WHERE email=?)';
function normalizedEmail(value) {
  const email = field(value, 254).toLowerCase();
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(email) ||
      email.indexOf('@') > 64) fail(400, 'أدخل بريدًا إلكترونيًا صالحًا.');
  return email;
}
export function classroom(db, owner, invite, initialize, limitSuggestion = async () => {}, ownerDeviceHash) {
  const notices = () => db.prepare('SELECT * FROM notices ORDER BY id DESC LIMIT 100').all();
  const feedback = student => {
    const query = 'SELECT f.id,f.body,f.created,f.reply,s.name FROM feedback f JOIN students s ON s.id=f.student';
    return student
      ? db.prepare(query + ' WHERE f.student=? ORDER BY f.created DESC LIMIT 100').all(student)
      : db.prepare(query + ' ORDER BY f.created DESC LIMIT 200').all();
  };
  function sourceId(id) {
    if (!Number.isSafeInteger(id) || id < 1) fail(400, 'المصدر غير صالح.');
    return id;
  }
  async function sharedSources(data, isOwner) {
    if (data.op === 'source') {
      const entry = await db.prepare('SELECT id, subject, title, image, added_by, created FROM shared_sources WHERE id=?').get(sourceId(data.id));
      if (!entry) fail(404, 'المصدر غير موجود.');
      return { entry };
    }
    const before = data.before == null ? Number.MAX_SAFE_INTEGER : sourceId(data.before);
    const all = isOwner && data.subject == null;
    const columns = 'SELECT id, subject, title, added_by, created FROM shared_sources';
    const entries = all
      ? await db.prepare(columns + ' WHERE id<? ORDER BY id DESC LIMIT 21').all(before)
      : await db.prepare(columns + ' WHERE subject=? AND id<? ORDER BY id DESC LIMIT 21').all(field(data.subject, 100), before);
    const more = entries.length > 20;
    if (more) entries.pop();
    return { entries, next: more ? entries.at(-1).id : null };
  }
  return async (authorization, data) => {
    if (typeof owner !== 'string' || owner.length < 32 || typeof invite !== 'string' || invite.length < 24 || owner === invite) {
      fail(503, 'الربط عبر الإنترنت قيد الإعداد.');
    }
    const key = digest(authorization.match(/^Bearer ([a-zA-Z0-9_-]+)$/)?.[1] ?? '');
    const hashOwner = digest(owner);
    const device = authorization.match(/^OwnerDevice ([a-zA-Z0-9_-]{43})$/)?.[1];
    const approved = typeof ownerDeviceHash === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(ownerDeviceHash)
      ? Buffer.from(ownerDeviceHash, 'base64url') : null;
    const trustedDevice = Boolean(device && approved && timingSafeEqual(digest(device), approved));
    const hashInvite = digest(invite);
    if (trustedDevice || timingSafeEqual(key, hashOwner)) {
      await initialize();
      switch (data.op) {
        case 'status': return {};
        case 'sources': case 'source': return sharedSources(data, true);
        case 'removesource': await db.prepare('DELETE FROM shared_sources WHERE id=?').run(sourceId(data.id)); return {};
        case 'notices': return { notices: await notices() };
        case 'publish':
          await db.prepare('INSERT INTO notices(title,body,created) VALUES(?,?,?)').run(field(data.title, 180), field(data.body, 12000), Date.now());
          return {};
        case 'feedback': return { entries: await feedback() };
        case 'reply':
          if (!(await db.prepare('UPDATE feedback SET reply=? WHERE id=?').run(field(data.body, 2000), identifier(data.id))).changes) fail(404, 'الاقتراح غير موجود.');
          return {};
        case 'registrations': {
          const entries = await db.prepare(`
            SELECT s.name,s.created,e.email,b.email IS NOT NULL AS blocked
            FROM students s LEFT JOIN student_emails e ON e.student=s.id
            LEFT JOIN blocked_emails b ON b.email=e.email ORDER BY s.created DESC LIMIT 200`).all();
          return { entries, total: (await db.prepare('SELECT count(*) AS total FROM students').get()).total };
        }
        case 'blockemail': case 'unblockemail': {
          const email = normalizedEmail(data.email);
          if (data.op === 'blockemail') await db.prepare('INSERT OR IGNORE INTO blocked_emails(email) VALUES(?)').run(email);
          else await db.prepare('DELETE FROM blocked_emails WHERE email=?').run(email);
          return {};
        }
        default: fail(400, 'العملية غير متاحة.');
      }
    }
    const deviceToken = authorization.match(/^Device ([a-zA-Z0-9_-]{43})$/)?.[1];
    if (!timingSafeEqual(key, hashInvite) && (!deviceToken || deviceToken !== data.device)) {
      fail(401, 'تعذّر التحقق من اتصال الطالب.');
    }
    if (!['register','sync','suggest','sources','source','addsource'].includes(data.op)) fail(400, 'العملية غير متاحة.');
    const student = digest(identifier(data.device)).toString('hex');
    await initialize();
    if (data.op === 'register') {
      const email = normalizedEmail(data.email);
      const name = field(data.name, 100);
      await db.prepare(`INSERT OR IGNORE INTO student_emails(student,email) SELECT ?,? WHERE ${allowedStudent}`)
        .run(student, email, email);
      if (await db.prepare('SELECT 1 FROM blocked_emails WHERE email=?').get(email)) fail(403, blockedMessage);
      const binding = await db.prepare('SELECT email FROM student_emails WHERE student=?').get(student);
      if (binding?.email !== email) fail(409, 'هذا الجهاز مرتبط ببريد آخر.');
      await db.prepare(`INSERT OR IGNORE INTO students(id,name,created) SELECT ?,?,? WHERE ${allowedStudent}`)
        .run(student, name, Date.now(), email);
      if (await db.prepare('SELECT 1 FROM blocked_emails WHERE email=?').get(email)) fail(403, blockedMessage);
      return { email };
    }
    const registration = await db.prepare(`
      SELECT s.name,e.email,b.email IS NOT NULL AS blocked FROM students s
      JOIN student_emails e ON e.student=s.id LEFT JOIN blocked_emails b ON b.email=e.email WHERE s.id=?`).get(student);
    if (!registration) fail(400, 'اربط بريدك الإلكتروني بحساب الطالب أولًا.');
    if (registration.blocked) fail(403, blockedMessage);
    if (['suggest','addsource'].includes(data.op)) await limitSuggestion(student);
    switch (data.op) {
      case 'sources': case 'source': return sharedSources(data, false);
      case 'addsource': {
        const image = data.image;
        if (typeof image !== 'string' || image.length > 550000 ||
            !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image)) fail(400, 'أرسل صورة JPEG صالحة.');
        const requestId = identifier(data.requestId);
        const saved = await db.prepare(`INSERT OR IGNORE INTO shared_sources(publisher,request_id,subject,title,image,added_by,created)
          SELECT ?,?,?,?,?,?,? WHERE ${allowedStudent}`)
          .run(student, requestId, field(data.subject, 100), field(data.title, 180), image, registration.name, Date.now(), registration.email);
        if (!saved.changes && await db.prepare('SELECT 1 FROM blocked_emails WHERE email=?').get(registration.email)) fail(403, blockedMessage);
        return {};
      }
      case 'sync': return { notices: await notices(), entries: await feedback(student) };
      case 'suggest': {
        const id = digest(student + ':' + identifier(data.requestId)).toString('hex');
        const saved = await db.prepare(`INSERT OR IGNORE INTO feedback(id,student,body,created) SELECT ?,?,?,? WHERE ${allowedStudent}`)
          .run(id, student, field(data.body, 2000), Date.now(), registration.email);
        if (!saved.changes && await db.prepare('SELECT 1 FROM blocked_emails WHERE email=?').get(registration.email)) fail(403, blockedMessage);
        return { entries: await feedback(student) };
      }
      default: fail(400, 'العملية غير متاحة.');
    }
  };
}
