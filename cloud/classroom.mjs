import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
  'CREATE TABLE IF NOT EXISTS owner_invites (code TEXT PRIMARY KEY, expires INTEGER NOT NULL, device TEXT UNIQUE)',
  'CREATE TABLE IF NOT EXISTS classroom_invites (code TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, student TEXT UNIQUE, claimed INTEGER)',
  `CREATE TRIGGER IF NOT EXISTS claim_classroom_invite AFTER UPDATE OF student ON classroom_invites
    WHEN OLD.student IS NULL AND NEW.student IS NOT NULL BEGIN
      INSERT INTO students(id,name,created) VALUES(NEW.student,NEW.name,NEW.claimed)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name;
      INSERT INTO student_emails(student,email) VALUES(NEW.student,NEW.email)
      ON CONFLICT(student) DO UPDATE SET email=excluded.email;
    END;`,
];
const blockedMessage = 'هذا البريد محظور من الصف.';
const allowedStudent = 'NOT EXISTS (SELECT 1 FROM blocked_emails WHERE email=?)';
function normalizedEmail(value) {
  const email = field(value, 254).toLowerCase();
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(email) ||
      email.indexOf('@') > 64) fail(400, 'أدخل بريدًا إلكترونيًا صالحًا.');
  return email;
}
const devicePattern = /^[a-zA-Z0-9_-]{43}$/;
const hash = value => digest(value).toString('hex');
const unauthorized = () => fail(401, 'اربط الجهاز بدعوة من مالك الصف.');
export function classroom(db, owner, initialize, { maxStudents = 200, limitSuggestion = async () => {}, ownerDeviceHash, files } = {}) {
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
  const publishedSource = "(publisher='owner' OR id IN (SELECT source FROM approved_shared_sources))";
  async function readSource(id, isOwner, publisher) {
    const visibility = isOwner ? '' : ' AND (' + publishedSource + ' OR publisher=?)';
    const entry = await db.prepare('SELECT id,subject,title,image,added_by,created FROM shared_sources WHERE id=?' + visibility)
      .get(sourceId(id), ...(isOwner ? [] : [publisher]));
    if (!entry) fail(404, 'المصدر غير موجود.');
    return entry;
  }
  async function downloadSource(data, isOwner, publisher) {
    const { image } = await readSource(data.id, isOwner, publisher);
    const file = image.startsWith('{') ? JSON.parse(image) : null;
    if (!file?.key) fail(404, 'الملف غير موجود.');
    return files.download(file);
  }
  async function removeSource(data, publisher) {
    const id = sourceId(data.id);
    const filter = ' WHERE id=?' + (publisher ? ' AND publisher=?' : '');
    const args = publisher ? [id, publisher] : [id];
    const entry = await db.prepare('SELECT image FROM shared_sources' + filter).get(...args);
    if (!entry && publisher) fail(403, 'يمكنك حذف المصادر التي نشرتها فقط.');
    await db.prepare('DELETE FROM shared_sources' + filter).run(...args);
    if (entry?.image.startsWith('{')) {
      const { key } = JSON.parse(entry.image);
      if (key) await files.remove(key);
    }
    return {};
  }
  async function startSource(data, publisher) {
    const requestId = identifier(data.requestId);
    if (await db.prepare('SELECT 1 FROM shared_sources WHERE publisher=? AND request_id=?').get(publisher, requestId))
      return { saved: true };
    return files.start({ size: data.size, name: field(data.name, 180), title: field(data.title, 180),
      subject: field(data.subject, 100), requestId }, publisher);
  }
  async function finishSource(data, publisher, author, email) {
    return files.finish(data, publisher, async (session, file) => {
      const result = await saveSource(session, publisher, author, email, JSON.stringify(file));
      const saved = await db.prepare('SELECT image FROM shared_sources WHERE publisher=? AND request_id=?')
        .get(publisher, session.requestId);
      if (saved?.image !== JSON.stringify(file)) await files.remove(file.key);
      return result;
    });
  }
  async function sharedSources(data, isOwner, publisher) {
    const visibility = isOwner ? '' : ' AND (' + publishedSource + ' OR publisher=?)';
    const viewer = isOwner ? [] : [publisher];
    if (data.op === 'source') {
      const entry = await readSource(data.id, isOwner, publisher);
      if (entry.image.startsWith('{')) {
        const { key, ...file } = JSON.parse(entry.image);
        entry.file = file;
        delete entry.image;
      }
      return { entry };
    }
    const before = data.before == null ? Number.MAX_SAFE_INTEGER : sourceId(data.before);
    const all = isOwner && data.subject == null;
    const columns = `SELECT id,subject,title,added_by,created,substr(image,1,1)='{' AS attachment,
      publisher=? AS mine,${publishedSource} AS approved FROM shared_sources`;
    const compatible = data.files === true ? '' : " AND substr(image,1,1)<>'{'";
    const subjectFilter = all ? '' : ' AND subject=?';
    const args = all ? [] : [field(data.subject, 100)];
    const entries = await db.prepare(columns + ' WHERE id<?' + subjectFilter + compatible + visibility + ' ORDER BY id DESC LIMIT 21')
      .all(publisher, before, ...args, ...viewer);
    const more = entries.length > 20;
    if (more) entries.pop();
    return { entries, next: more ? entries.at(-1).id : null };
  }
  async function sourceCatalog(publisher, isOwner) {
    const predicate = isOwner ? '1' : publishedSource + ' OR publisher=?';
    const args = isOwner ? [] : [publisher];
    const subjects = await db.prepare(`SELECT name,sum(docs) AS docs FROM (
      SELECT name,0 AS docs FROM class_subjects
      UNION ALL SELECT subject,count(*) FROM shared_sources WHERE ${predicate} GROUP BY subject
    ) GROUP BY name ORDER BY name`).all(...args);
    return { subjects };
  }
  async function renameSource(data, publisher) {
    const args = [field(data.title,180), sourceId(data.id)];
    const owned = publisher ? ' AND publisher=?' : '';
    if (publisher) args.push(publisher);
    if (!(await db.prepare('UPDATE shared_sources SET title=? WHERE id=?' + owned).run(...args)).changes)
      fail(404, 'المصدر غير موجود أو لا تملك صلاحية تعديله.');
    return {};
  }
  async function addSource(data,publisher,author,email) {
    let content=data.image;
    if(data.file!=null){
      const name=field(data.file.name,180);
      const {base64}=data.file;
      if(/[\x00-\x1f\x7f/\\]/.test(name) || typeof base64!=='string' || !base64 ||
         base64.length>1398104 || base64.length%4!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
         Buffer.from(base64,'base64').length>1048576)fail(400,'اختر ملفًا صالحًا حتى ١ ميغابايت.');
      content=JSON.stringify({name,base64});
    }else if(typeof content!=='string' || content.length>550000 ||
       !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(content))fail(400,'أرسل صورة JPEG صالحة.');
    return saveSource(data, publisher, author, email, content);
  }
  async function saveSource(data, publisher, author, email, content) {
    const requestId=identifier(data.requestId);
    const fields=[publisher,requestId,field(data.subject,100),field(data.title,180),content,author,Date.now()];
    if(!email){
      await db.prepare('INSERT OR IGNORE INTO shared_sources(publisher,request_id,subject,title,image,added_by,created) VALUES(?,?,?,?,?,?,?)').run(...fields);
      return {};
    }
    const saved=await db.prepare(`INSERT OR IGNORE INTO shared_sources(publisher,request_id,subject,title,image,added_by,created)
      SELECT ?,?,?,?,?,?,? WHERE ${allowedStudent}`)
      .run(...fields,email);
    if (!saved.changes && await db.prepare('SELECT 1 FROM blocked_emails WHERE email=?').get(email))
      fail(403, blockedMessage);
    return {pending:true};
  }
  async function studyList(data){
    const entries=await db.prepare('SELECT id,title,kind,body,created FROM shared_lessons WHERE subject=? ORDER BY id DESC LIMIT 100')
      .all(field(data.subject,100));
    return {entries:entries.map(entry=>entry.kind==='quiz'?{...entry,body:JSON.parse(entry.body)}:entry)};
  }
  async function addLesson(data){
    const subject=field(data.subject,100), title=field(data.title,180);
    let body,answer=null;
    switch(data.kind){
      case 'summary': body=field(data.body,12000); break;
      case 'link': {
        try{
          const url=new URL(field(data.body,2000));
          if(url.protocol!=='https:'||url.username||url.password)throw Error();
          body=url.href;
        }catch{fail(400,'أدخل رابط اختبار يبدأ بـ HTTPS.');}
        break;
      }
      case 'quiz': {
        if(!Array.isArray(data.choices)||data.choices.length<2||data.choices.length>8||
           !Number.isInteger(data.answer)||data.answer<0||data.answer>=data.choices.length)fail(400,'أدخل الخيارات وحدّد الإجابة الصحيحة.');
        body=JSON.stringify({question:field(data.question,1800),choices:data.choices.map(choice=>field(choice,500))});
        answer=data.answer;
        break;
      }
      default: fail(400,'نوع المحتوى غير صالح.');
    }
    await db.prepare('INSERT INTO shared_lessons(subject,title,kind,body,answer,created) VALUES(?,?,?,?,?,?)')
      .run(subject,title,data.kind,body,answer,Date.now());
    return {};
  }
  async function solveLesson(data){
    const quiz=await db.prepare("SELECT body,answer FROM shared_lessons WHERE id=? AND kind='quiz'").get(sourceId(data.id));
    if(!quiz)fail(404,'الاختبار غير موجود.');
    if(!Number.isInteger(data.choice)||data.choice<0||data.choice>=JSON.parse(quiz.body).choices.length)
      fail(400,'اختر إجابة صالحة.');
    return {correct:data.choice===quiz.answer,answer:quiz.answer};
  }
  async function ownerReport() {
    const totals = await db.prepare(`SELECT
      (SELECT count(*) FROM students) AS students,
      (SELECT count(*) FROM shared_sources) AS sources,
      (SELECT count(*) FROM notices) AS notices,
      (SELECT count(*) FROM feedback WHERE reply IS NULL OR reply='') AS pending`).get();
    const subjects = await db.prepare('SELECT subject,count(*) AS total FROM shared_sources GROUP BY subject ORDER BY total DESC,subject').all();
    return {totals, subjects};
  }
  return async (authorization, data, request) => {
    if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{32,}$/.test(owner)) {
      fail(503, 'الربط عبر الإنترنت قيد الإعداد.');
    }
    const key = digest(authorization.match(/^Bearer ([a-zA-Z0-9_-]+)$/)?.[1] ?? '');
    const hashOwner = digest(owner);
    const device = authorization.match(/^OwnerDevice ([a-zA-Z0-9_-]{43})$/)?.[1];
    const approved = typeof ownerDeviceHash === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(ownerDeviceHash)
      ? Buffer.from(ownerDeviceHash, 'base64url') : null;
    const trustedDevice = Boolean(device && approved && timingSafeEqual(digest(device), approved));
    if (data.op === 'register-owner') {
      const token = authorization.match(/^Invite ([a-zA-Z0-9_-]{43})$/)?.[1];
      if (!token || typeof data.device !== 'string' || !devicePattern.test(data.device)) unauthorized();
      const deviceId=hash(data.device), code=hash(token), now=Date.now();
      await initialize();
      await db.prepare('UPDATE OR IGNORE owner_invites SET device=? WHERE code=? AND device IS NULL AND expires>?').run(deviceId,code,now);
      if((await db.prepare('SELECT device FROM owner_invites WHERE code=?').get(code))?.device!==deviceId) unauthorized();
      return {};
    }
    if (device && !trustedDevice) await initialize();
    if (trustedDevice || timingSafeEqual(key, hashOwner) || (device && await db.prepare('SELECT 1 FROM owner_invites WHERE device=?').get(hash(device)))) {
      await initialize();
      switch (data.op) {
        case 'status': return {};
        case 'sources': case 'source': return sharedSources(data, true, 'owner');
        case 'report': return ownerReport();
        case 'subjects': return sourceCatalog('owner',true);
        case 'renamesource': return renameSource(data);
        case 'addsource': return addSource(data,'owner','المالك');
        case 'startsource': return startSource(data, 'owner');
        case 'sourcepart': return files.part(data, 'owner', request);
        case 'finishsource': return finishSource(data, 'owner', 'المالك');
        case 'abortsource': return files.abort(data, 'owner');
        case 'downloadsource': return downloadSource(data, true, 'owner');
        case 'study': return studyList(data);
        case 'addsubject': await db.prepare('INSERT OR IGNORE INTO class_subjects(name) VALUES(?)').run(field(data.name,80)); return {};
        case 'addlesson': return addLesson(data);
        case 'approvesource': {
          const id = sourceId(data.id);
          await db.prepare('INSERT OR IGNORE INTO approved_shared_sources(source) SELECT id FROM shared_sources WHERE id=?').run(id);
          return {};
        }
        case 'removesource': return removeSource(data);
        case 'notices': return { notices: await notices() };
        case 'publish':
          await db.prepare('INSERT INTO notices(title,body,created) VALUES(?,?,?)').run(field(data.title, 180), field(data.body, 12000), Date.now());
          return {};
        case 'feedback': return { entries: await feedback() };
        case 'reply': {
          const id=identifier(data.id), reply=field(data.body,2000);
          if (!(await db.prepare('UPDATE feedback SET reply=? WHERE id=?').run(reply,id)).changes) fail(404,'الاقتراح غير موجود.');
          return {id,reply};
        }
        case 'create-owner-invite': {
          if (!timingSafeEqual(key,hashOwner)) fail(403,'أنشئ اعتماد المالك من لوحة الدعوات على الويب.');
          const invite=randomBytes(32).toString('base64url'), now=Date.now(), expires=now+600000;
          await db.prepare('DELETE FROM owner_invites WHERE device IS NULL').run();
          await db.prepare('INSERT INTO owner_invites(code,expires) VALUES(?,?)').run(hash(invite),expires);
          return {invite,expires};
        }
        case 'create-invite': {
          const name = field(data.name, 100);
          const email = normalizedEmail(data.email);
          const token = randomBytes(32).toString('base64url');
          const now = Date.now();
          const expires = now + 86400000;
          await db.prepare('DELETE FROM classroom_invites WHERE student IS NULL AND expires<=?').run(now);
          if (await db.prepare('SELECT 1 FROM blocked_emails WHERE email=?').get(email)) fail(403, blockedMessage);
          const result = await db.prepare(`INSERT OR IGNORE INTO classroom_invites(code,name,email,expires)
            SELECT ?,?,?,? WHERE (SELECT count(*) FROM classroom_invites) < ? AND ${allowedStudent}`)
            .run(hash(token), name, email, expires, maxStudents, email);
          if (!result.changes) fail(409, 'لهذا البريد دعوة أو تسجيل حالي، أو بلغ الصف الحد الأقصى.');
          return { invite: token, expires };
        }
        case 'revoke-invite': {
          const email = normalizedEmail(data.email);
          if (!(await db.prepare('DELETE FROM classroom_invites WHERE email=? AND student IS NULL').run(email)).changes)
            fail(404, 'لا توجد دعوة معلّقة لهذا البريد.');
          return {};
        }
        case 'reset-registration': {
          const email = normalizedEmail(data.email);
          if (!(await db.prepare('DELETE FROM classroom_invites WHERE email=? AND student IS NOT NULL').run(email)).changes)
            fail(404, 'لا يوجد جهاز مرتبط بهذا البريد.');
          return {};
        }
        case 'registrations': {
          const entries = await db.prepare(`
            SELECT s.name,s.created,e.email,b.email IS NOT NULL AS blocked,i.student IS NOT NULL AS enrolled
            FROM students s LEFT JOIN student_emails e ON e.student=s.id
            LEFT JOIN blocked_emails b ON b.email=e.email LEFT JOIN classroom_invites i ON i.student=s.id ORDER BY s.created DESC LIMIT 200`).all();
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
    if (data.op === 'register') {
      const token = authorization.match(/^Invite ([a-zA-Z0-9_-]{43})$/)?.[1];
      if (!token || typeof data.device !== 'string' || !devicePattern.test(data.device)) unauthorized();
      const email = normalizedEmail(data.email);
      const student = hash(data.device);
      const code = hash(token);
      const now = Date.now();
      await initialize();
      const invite = await db.prepare('SELECT email FROM classroom_invites WHERE code=?').get(code);
      if (invite?.email !== email) unauthorized();
      if (await db.prepare('SELECT 1 FROM blocked_emails WHERE email=?').get(email)) fail(403, blockedMessage);
      await db.prepare(`UPDATE OR IGNORE classroom_invites SET student=?,claimed=?
        WHERE code=? AND student IS NULL AND expires>? AND ${allowedStudent}
        AND NOT EXISTS (SELECT 1 FROM student_emails WHERE student=? AND email<>?)`)
        .run(student, now, code, now, email, student, email);
      const claimed = await db.prepare('SELECT student FROM classroom_invites WHERE code=?').get(code);
      if (claimed?.student !== student) unauthorized();
      return { email };
    }
    const deviceToken = authorization.match(/^Device ([a-zA-Z0-9_-]{43})$/)?.[1];
    if (!deviceToken || (data.device !== undefined && deviceToken !== data.device)) unauthorized();
    if (!['sync','suggest','sources','source','addsource','removesource','renamesource','study','solve','subjects','startsource','sourcepart','finishsource','abortsource','downloadsource'].includes(data.op)) fail(400, 'العملية غير متاحة.');
    const student = hash(deviceToken);
    await initialize();
    const registration = await db.prepare(`
      SELECT i.name,i.email,b.email IS NOT NULL AS blocked FROM classroom_invites i
      LEFT JOIN blocked_emails b ON b.email=i.email WHERE i.student=?`).get(student);
    if (!registration) unauthorized();
    if (registration.blocked) fail(403, blockedMessage);
    if (data.op === 'suggest') await limitSuggestion(student);
    switch (data.op) {
      case 'sources': case 'source': return sharedSources(data, false, student);
      case 'study': return studyList(data);
      case 'solve': return solveLesson(data);
      case 'subjects': return sourceCatalog(student,false);
      case 'renamesource': return renameSource(data,student);
      case 'removesource': return removeSource(data, student);
      case 'addsource': return addSource(data, student, registration.name, registration.email);
      case 'startsource': return startSource(data, student);
      case 'sourcepart': return files.part(data, student, request);
      case 'finishsource': return finishSource(data, student, registration.name, registration.email);
      case 'abortsource': return files.abort(data, student);
      case 'downloadsource': return downloadSource(data, false, student);
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
