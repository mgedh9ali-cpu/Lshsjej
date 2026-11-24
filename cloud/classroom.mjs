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
export function classroom(db, owner, invite, initialize) {
  const notices = () => db.prepare('SELECT * FROM notices ORDER BY id DESC LIMIT 100').all();
  const feedback = student => {
    const query = 'SELECT f.id,f.body,f.created,f.reply,s.name FROM feedback f JOIN students s ON s.id=f.student';
    return student
      ? db.prepare(query + ' WHERE f.student=? ORDER BY f.created DESC LIMIT 100').all(student)
      : db.prepare(query + ' ORDER BY f.created DESC LIMIT 200').all();
  };
  return async (authorization, data) => {
    if (typeof owner !== 'string' || owner.length < 32 || typeof invite !== 'string' || invite.length < 24 || owner === invite) {
      fail(503, 'الربط عبر الإنترنت قيد الإعداد.');
    }
    const key = digest(authorization.match(/^Bearer ([a-zA-Z0-9_-]+)$/)?.[1] ?? '');
    const hashOwner = digest(owner);
    const hashInvite = digest(invite);
    if (timingSafeEqual(key, hashOwner)) {
      await initialize();
      switch (data.op) {
        case 'status': return {};
        case 'notices': return { notices: await notices() };
        case 'publish':
          await db.prepare('INSERT INTO notices(title,body,created) VALUES(?,?,?)').run(field(data.title, 180), field(data.body, 12000), Date.now());
          return {};
        case 'feedback': return { entries: await feedback() };
        case 'reply':
          if (!(await db.prepare('UPDATE feedback SET reply=? WHERE id=?').run(field(data.body, 2000), identifier(data.id))).changes) fail(404, 'الاقتراح غير موجود.');
          return {};
        case 'registrations': {
          const entries = await db.prepare('SELECT name,created FROM students ORDER BY created DESC LIMIT 200').all();
          return { entries, total: (await db.prepare('SELECT count(*) AS total FROM students').get()).total };
        }
        default: fail(400, 'العملية غير متاحة.');
      }
    }
    if (!timingSafeEqual(key, hashInvite)) fail(401, 'تحقّق من مفتاح الصف.');
    if (!['sync','suggest'].includes(data.op)) fail(400, 'العملية غير متاحة.');
    await initialize();
    const student = digest(identifier(data.device)).toString('hex');
    await db.prepare('INSERT OR IGNORE INTO students VALUES(?,?,?)').run(student, field(data.name, 100), Date.now());
    switch (data.op) {
      case 'sync': return { notices: await notices(), entries: await feedback(student) };
      case 'suggest': {
        const id = digest(student + ':' + identifier(data.requestId)).toString('hex');
        await db.prepare('INSERT OR IGNORE INTO feedback(id,student,body,created) VALUES(?,?,?,?)').run(id, student, field(data.body, 2000), Date.now());
        return { entries: await feedback(student) };
      }
      default: fail(400, 'العملية غير متاحة.');
    }
  };
}
