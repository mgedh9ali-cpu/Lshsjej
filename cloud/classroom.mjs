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
export function classroom(db, owner, invite, initialize, limitSuggestion = async () => {}, ownerDeviceHash) {
  const notices = () => db.prepare(`SELECT id,title,body,created FROM notices
    UNION ALL SELECT -id,added_by || ' نشر مصدرًا في ' || subject,title,created FROM shared_sources
    ORDER BY created DESC,id DESC LIMIT 100`).all();
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
  async function sharedSources(data, isOwner, publisher) {
    if (data.op === 'source') {
      const entry = await db.prepare('SELECT id, subject, title, image, added_by, created FROM shared_sources WHERE id=?').get(sourceId(data.id));
      if (!entry) fail(404, 'المصدر غير موجود.');
      if(entry.image.startsWith('{')){
        entry.file=JSON.parse(entry.image);delete entry.image;
      }
      return { entry };
    }
    const before = data.before == null ? Number.MAX_SAFE_INTEGER : sourceId(data.before);
    const all = isOwner && data.subject == null;
    const columns = `SELECT id, subject, title, added_by, created,
        CASE WHEN substr(image,1,1)='{' THEN 1 ELSE 0 END AS attachment,
        CASE WHEN publisher=? THEN 1 ELSE 0 END AS mine FROM shared_sources`;
    const compatible = data.files === true ? '' : " AND substr(image,1,1)<>'{'";
    const entries = all
      ? await db.prepare(columns + ' WHERE id<?' + compatible + ' ORDER BY id DESC LIMIT 21').all(publisher ?? '', before)
      : await db.prepare(columns + ' WHERE subject=? AND id<?' + compatible + ' ORDER BY id DESC LIMIT 21').all(publisher ?? '', field(data.subject, 100), before);
    const more = entries.length > 20;
    if (more) entries.pop();
    return { entries, next: more ? entries.at(-1).id : null };
  }
  async function addSource(data,publisher,author) {
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
    await db.prepare('INSERT OR IGNORE INTO shared_sources(publisher,request_id,subject,title,image,added_by,created) VALUES(?,?,?,?,?,?,?)')
      .run(publisher,identifier(data.requestId),field(data.subject,100),field(data.title,180),content,author,Date.now());
    return {};
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
        case 'report': return ownerReport();
        case 'sources': case 'source': return sharedSources(data, true, 'owner');
        case 'addsource': return addSource(data,'owner','المالك');
        case 'study': return studyList(data);
        case 'addsubject': await db.prepare('INSERT OR IGNORE INTO class_subjects(name) VALUES(?)').run(field(data.name,80)); return {};
        case 'addlesson': return addLesson(data);
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
          const entries = await db.prepare('SELECT name,created FROM students ORDER BY created DESC LIMIT 200').all();
          return { entries, total: (await db.prepare('SELECT count(*) AS total FROM students').get()).total };
        }
        default: fail(400, 'العملية غير متاحة.');
      }
    }
    const deviceToken = authorization.match(/^Device ([a-zA-Z0-9_-]{43})$/)?.[1];
    if (!timingSafeEqual(key, hashInvite) && (!deviceToken || deviceToken !== data.device)) {
      fail(401, 'تعذّر التحقق من اتصال الطالب.');
    }
    if (!['sync','suggest','sources','source','addsource','removesource','study','solve','subjects'].includes(data.op)) fail(400, 'العملية غير متاحة.');
    const student = digest(identifier(data.device)).toString('hex');
    if (['suggest','addsource'].includes(data.op)) await limitSuggestion(student);
    await initialize();
    await db.prepare('INSERT OR IGNORE INTO students VALUES(?,?,?)').run(student, field(data.name, 100), Date.now());
    switch (data.op) {
      case 'sources': case 'source': return sharedSources(data, false, student);
      case 'study': return studyList(data);
      case 'solve': return solveLesson(data);
      case 'subjects': return {subjects:await db.prepare('SELECT name FROM class_subjects ORDER BY name LIMIT 100').all()};
      case 'removesource':
        if(!(await db.prepare('DELETE FROM shared_sources WHERE id=? AND publisher=?').run(sourceId(data.id),student)).changes)
          fail(403,'يمكنك حذف المصادر التي نشرتها فقط.');
        return {};
      case 'addsource': {
        const author = await db.prepare('SELECT name FROM students WHERE id=?').get(student);
        return addSource(data,student,author.name);
      }
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
