import { app, nav, el, button, heading, line, input, select, api, form, login, temporary, logout, empty, errorView, date, archiveView, imageFile } from './common.js';

let me;
let sequence = 0;
const owner = () => me.role === 'owner';
const can = name => owner() || me.permissions.includes(name);
const required = { required: true };
const textField = (name, label, value = '') => line(label, input(name, { ...required, value }));
const area = (name, value = '', props = {}) => el('textarea', { name, rows: 5, ...required, ...props }, value);
const card = (...children) => el('article', { class: 'card' }, children);
const grants = [['quizzes', 'مسودات الاختبارات'], ['notices', 'مسودات الأخبار والتذكيرات'], ['publishNotices', 'نشر الأخبار والتذكيرات']];
const action = (label, fn) => {
  const status = el('span', { role: 'status', class: 'message' });
  const control = button(label, async () => {
    control.disabled = true;
    try { status.textContent = (await fn()) || ''; }
    catch (error) { status.textContent = error.message; }
    finally { control.disabled = false; }
  });
  return el('div', { class: 'actions' }, control, status);
};
const show = fn => async () => {
  const current = ++sequence;
  try {
    const view = await fn();
    if (sequence === current) app.replaceChildren(...view);
  } catch (error) { if (sequence === current) errorView(error); }
};
const picker = (subjects, optional = false, value = '') => {
  const control = select('subject', [...(optional ? [['', 'كل الطلاب']] : []), ...subjects.map(item => [item.id, item.name])]);
  if (value) control.value = String(value);
  return line('المادة', control);
};
const permissionInputs = chosen => grants.map(([key, label]) =>
  el('label', { class: 'option' }, input(key, { type: 'checkbox', checked: chosen.includes(key) }), label));
const permissionValues = data => grants.map(([key]) => key).filter(key => data[key]);
const credentials = records => records.map(record => record.name + ' · ' + record.username + ' · ' + record.password).join('\n');
const accountPage = show(async () => {
  const items = await api('/accounts');
  const afterCreate = async (payload, message, element) => {
    const accounts = await api('/accounts', payload);
    element.reset();
    message.textContent = credentials(accounts);
    message.append(' ', button('تحديث القائمة', accountPage));
  };
  return [heading('الحسابات', 'أنشئ حسابات الطلاب والمساعدين من هنا.'), el('div', { class: 'grid' },
    form([textField('name', 'الاسم الحقيقي'), textField('username', 'اسم المستخدم بالإنجليزية'),
      line('كلمة مرور مؤقتة · اختياري', input('password', { type: 'password', minlength: 12, autocomplete: 'new-password' })),
      line('نوع الحساب', select('role', [['student', 'طالب'], ['assistant', 'مساعد']])),
      ...permissionInputs([])], 'إنشاء حساب', (data, message, element) => afterCreate({ ...data, permissions: permissionValues(data) }, message, element)),
    form([line('حسابات طلاب دفعة واحدة · الاسم | اسم المستخدم', area('list', '', { placeholder: 'اسم الطالب | student01' }))],
      'إنشاء الحسابات', (data, message, element) => {
        const accounts = data.list.split(/\r?\n/).filter(line => line.trim()).map(line => {
          const parts = line.split('|');
          if (parts.length !== 2) throw Error('أدخل الاسم واسم المستخدم في كل سطر وبينهما |');
          return { name: parts[0], username: parts[1] };
        });
        return afterCreate({ accounts }, message, element);
      })),
    el('h2', {}, 'الحسابات الحالية'), items.length ? el('div', { class: 'grid' }, items.map(item => card(
      el('h3', {}, item.name), el('p', {}, item.username + ' · ' + (item.role === 'student' ? 'طالب' : 'مساعد') + ' · ' + (item.active ? 'فعّال' : 'معطّل')),
      action('إعادة تعيين كلمة المرور', async () => {
        if (!window.confirm('إعادة التعيين ستنهي جلسات هذا الحساب. المتابعة؟')) return;
        return 'كلمة المرور المؤقتة · ' + (await api('/account', { id: item.id, action: 'reset' })).password;
      }),
      action(item.active ? 'تعطيل الحساب' : 'تفعيل الحساب', async () => {
        await api('/account', { id: item.id, active: !item.active });
        accountPage();
      }), item.role === 'assistant' && form(permissionInputs(item.permissions), 'حفظ الصلاحيات', async (data, message) => {
        await api('/account', { id: item.id, action: 'permissions', permissions: permissionValues(data) });
        message.textContent = 'حُفظت الصلاحيات.';
      })))) : empty('ما في حسابات بعد.')];
});
const documentsPage = show(async () => {
  const [subjects, docs] = await Promise.all([api('/subjects'), api('/documents')]);
  const editor = item => form([picker(subjects, false, item?.subject), textField('title', 'العنوان', item?.title),
    line('محتوى المستند', area('body', item?.body))], 'حفظ المستند', async data => {
    await api('/documents', { ...data, id: item?.id });
    documentsPage();
  });
  return [heading('المواد والمستندات'), el('div', { class: 'grid' },
    form([textField('name', 'اسم المادة الجديدة')], 'إضافة مادة', async data => { await api('/subjects', data); documentsPage(); }),
    editor()), el('h2', {}, 'المستندات المنشورة'), ...docs.map(item =>
      el('details', { class: 'card' }, el('summary', {}, item.title + ' · ' + item.subjectName), editor(item)))];
});
const archivePage = selected => show(async () => {
  const subjects = await api('/subjects');
  const subjectId = selected ?? subjects[0]?.id;
  if (!subjectId) return [heading('الأرشيف اليومي'), empty('أضف مادة أولًا.')];
  const archive = await api('/archive?subject=' + subjectId);
  const reload = archivePage(subjectId);
  const choice = select('subject', subjects.map(item => [item.id, item.name]));
  choice.value = String(subjectId);
  choice.addEventListener('change', () => archivePage(Number(choice.value))());
  return [heading('الأرشيف اليومي'),
    line('المادة', choice),
    el('div', { class: 'grid' },
      form([line('الصفحة التي وصل إليها الصف', input('page', { type: 'number', min: 1, max: 10000, step: 1, value: archive.page, required: true }))],
        'حفظ رقم الصفحة', async data => { await api('/progress', { subject: subjectId, page: Number(data.page) }); await reload(); }),
      form([line('عنوان الصورة', input('title', { maxlength: 160 })),
        line('التاريخ · يُستخدم تاريخ اليوم إذا تركته فارغًا', input('day', { type: 'date' })),
        line('اختر صورة', input('file', { type: 'file', accept: 'image/jpeg,image/png,image/webp', required: true }))],
        'إضافة الصورة', async data => { await api('/archive-image', { subject: subjectId, title: data.title, day: data.day, image: await imageFile(data.file) }); await reload(); })),
    ...archiveView(archive, (item, number) => el('p', {}, 'مستند ' + number + ' · ' + item.title),
      image => action('حذف الصورة', async () => {
        if (!confirm('حذف هذه الصورة من أرشيف المادة؟')) return;
        await api('/archive-image-remove', { id: image.id });
        await reload();
      })),
  ];
});
function quizEditor(subjects, quiz) {
  const questionList = el('div', { class: 'stack' });
  function add(question = { text: '', options: ['', ''], correct: 0 }) {
    const title = input('question', { ...required, value: question.text });
    const options = area('options', question.options.join('\n'), { rows: 3 });
    const correct = input('correct', { ...required, type: 'number', min: 1, max: 6, value: question.correct + 1 });
    const field = el('fieldset', {}, el('legend', {}, 'سؤال'), line('نص السؤال', title),
      line('الخيارات · سطر لكل خيار', options), line('رقم الخيار الصحيح', correct),
      button('إزالة السؤال', () => field.remove()));
    questionList.append(field);
  }
  if (quiz) quiz.questions.forEach(add);
  else add();
  return form([picker(subjects, false, quiz?.subject), textField('title', 'عنوان الاختبار', quiz?.title), questionList,
    el('div', { class: 'actions' }, button('إضافة اختيار من متعدد', () => add()),
      button('إضافة صح أو خطأ', () => add({ text: '', options: ['صح', 'خطأ'], correct: 0 })))],
    'حفظ المسودة', async data => {
      const questions = [...questionList.children].map(field => ({
        text: field.querySelector('[name=question]').value,
        options: field.querySelector('[name=options]').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        correct: Number(field.querySelector('[name=correct]').value) - 1,
      }));
      await api('/quizzes', { ...data, questions, id: quiz?.id });
      quizzesPage();
    });
}
const quizzesPage = show(async () => {
  const [subjects, quizzes] = await Promise.all([api('/subjects'), api('/quizzes')]);
  return [heading('الاختبارات', 'أدخل الأسئلة أو انسخها من المصدر الذي تستخدمه. الاختبار يظهر للطلاب بعد اعتماد المالك.'),
    el('details', { class: 'card' }, el('summary', {}, 'إضافة اختبار'), quizEditor(subjects)), ...quizzes.map(quiz =>
      el('details', { class: 'card' }, el('summary', {}, quiz.title + ' · ' + quiz.subjectName + ' · ' + (quiz.published ? 'منشور' : 'بانتظار الاعتماد')),
        quiz.published ? el('ol', {}, quiz.questions.map(question => el('li', {}, question.text))) : quizEditor(subjects, quiz),
        owner() && !quiz.published && action('اعتماد ونشر', async () => {
          if (!window.confirm('نشر الاختبار للطلاب؟')) return;
          await api('/publish-quiz', { id: quiz.id });
          quizzesPage();
        })))];
});
const noticesPage = show(async () => {
  const [subjects, notices] = await Promise.all([api('/subjects'), api('/notices')]);
  return [heading('الأخبار والتذكيرات'), ...(can('notices') ? [form([
    line('النوع', select('kind', [['reminder', 'تذكير'], ['news', 'خبر']])), textField('title', 'العنوان'),
    line('النص', area('body')), picker(subjects, true), line('موعد الظهور · بتوقيت جهازك', input('visible', { type: 'datetime-local' })),
    can('publishNotices') && el('label', { class: 'option' }, input('publish', { type: 'checkbox' }), 'اعتماد النشر في الموعد المحدد'),
  ].filter(Boolean), 'حفظ', async data => {
    await api('/notices', { ...data, visible: data.visible ? new Date(data.visible).toISOString() : '', publish: Boolean(data.publish) });
    noticesPage();
  })] : []), ...notices.map(item => card(el('span', { class: 'tag' }, item.kind === 'news' ? 'خبر' : 'تذكير'),
    el('h2', {}, item.title), el('p', { class: 'prose' }, item.body),
    el('small', {}, (item.published ? 'موعد الظهور · ' : 'مسودة · ') + date(item.visible)),
    can('publishNotices') && !item.published && action('اعتماد النشر', async () => {
      await api('/publish-notice', { id: item.id });
      noticesPage();
    })))];
});
const auditPage = show(async () => {
  const items = await api('/audit');
  return [heading('سجل التغييرات'), ...items.map(item => card(
    el('strong', {}, item.action), el('p', {}, item.actor + ' · ' + item.details), el('small', {}, date(item.created)))),
  ...(!items.length ? [empty('ما في تغييرات مسجلة بعد.')] : [])];
});
const dashboard = show(async () => {
  const overview = owner() ? await api('/overview') : null;
  const drafts = overview?.drafts ?? (can('quizzes') ? (await api('/quizzes')).filter(item => !item.published).length : 0);
  const metric = (label, value) => card(el('strong', { class: 'metric-value' }, String(value)), el('p', {}, label));
  return [heading('لوحة الإدارة', 'أهلًا، ' + me.name),
    overview && el('div', { class: 'metrics' },
      metric('طلاب فعّالون', overview.students), metric('مستندات منشورة', overview.documents), metric('اختبارات بانتظار الاعتماد', drafts)),
    el('div', { class: 'grid shortcuts' },
      owner() && button('إضافة طالب', accountPage, 'card subject'),
      (can('notices') || can('publishNotices')) && button('الأخبار والتذكيرات', noticesPage, 'card subject'),
      can('quizzes') && button('مراجعة الاختبارات', quizzesPage, 'card subject')),
    overview && el('section', { class: 'card processing-panel' },
      el('h2', {}, 'معالجة المساهمات'),
      el('p', {}, overview.engine === 'local' ? 'قارئ الصور المحلي' : 'معالجة عبر مزوّد خارجي'),
      el('div', { class: 'metrics' }, metric('قيد المعالجة', overview.processing), metric('موضوعات مكررة', overview.duplicates), metric('تحتاج إعادة رفع', overview.needsRetry))),
  ].filter(Boolean);
});
function ready(user) {
  me = user;
  nav.replaceChildren(logout());
  if (user.temporary) { temporary(ready); return; }
  nav.prepend(button('الرئيسية', dashboard),
    ...(owner() ? [button('الحسابات', accountPage), button('المواد والمستندات', documentsPage), button('الأرشيف اليومي', archivePage()), button('سجل التغييرات', auditPage)] : []),
    ...(can('quizzes') ? [button('الاختبارات', quizzesPage)] : []),
    ...(can('notices') || can('publishNotices') ? [button('الأخبار والتذكيرات', noticesPage)] : []));
  dashboard();
}
api('/me').then(ready).catch(error => error.status === 401 ? login('admin', ready) : errorView(error));
