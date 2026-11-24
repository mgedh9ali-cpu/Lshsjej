import { app, nav, el, button, heading, line, api, form, login, temporary, logout, empty, errorView, date, archiveView, imageFile } from './common.js';

let page = 0;
const display = fn => async () => {
  const current = ++page;
  app.replaceChildren(el('p', { role: 'status' }, 'جارٍ التحميل…'));
  try {
    const content = await fn(current);
    if (current === page) app.replaceChildren(...content.filter(Boolean));
  } catch (error) { if (current === page) errorView(error); }
};
function noticeList(items) {
  return items.length ? el('div', { class: 'grid' }, items.map(item => el('article', { class: 'card' },
    el('span', { class: 'tag' }, item.kind === 'reminder' ? 'تذكير' : 'خبر'),
    el('h2', {}, item.title), el('p', { class: 'prose' }, item.body),
    el('small', {}, [item.subjectName, date(item.visible)].filter(Boolean).join(' · '))))) : empty('ما في إعلانات حاليًا.');
}
const home = display(async () => {
  const subjects = await api('/subjects');
  return [heading('المواد الدراسية', 'اختر مادة لتفتح مستنداتها واختباراتها.'), el('div', { class: 'grid' }, subjects.map((item, index) =>
    button([el('span', { class: 'subject-icon', 'aria-hidden': 'true' }, ['⚡', '◇', '✿', 'Aa', '∑'][index % 5]), item.name], subjectPage(item), 'card subject')))];
});
const news = display(async () => [heading('الأخبار والتحديثات'), noticeList(await api('/notices'))]);
const results = display(async () => {
  const items = await api('/results');
  return [heading('نتائجي'), items.length ? el('div', { class: 'stack' }, items.map(item =>
    el('article', { class: 'card row' }, el('strong', {}, item.title), el('bdi', {}, item.score + ' / ' + item.total), el('small', {}, date(item.created))))) : empty('نتائج اختباراتك بتظهر هون.')];
});
const statusLabel = { processing: 'قيد المعالجة', published: 'نُشر المستند', duplicate: 'هذا الموضوع موجود مسبقًا', unreadable: 'الصورة غير واضحة أو لا تحتوي على مستند دراسي', failed: 'تعذّرت المعالجة. جرّب رفع الصورة مجددًا.' };
function subjectPage(subject, tab = 'documents') {
  return display(async current => {
    const query = '?subject=' + subject.id;
    const [items, notices] = await Promise.all([api((tab === 'documents' ? '/archive' : '/quizzes') + query), api('/notices')]);
    const controls = el('div', { class: 'actions', role: 'group', 'aria-label': 'أقسام المادة' },
      button('المصادر', subjectPage(subject), 'secondary', { 'aria-pressed': String(tab === 'documents') }),
      button('الاختبارات', subjectPage(subject, 'quizzes'), 'secondary', { 'aria-pressed': String(tab === 'quizzes') }));
    const content = [button('← المواد', home), heading(subject.name), controls];
    if (tab === 'quizzes') {
      content.push(items.length ? el('div', { class: 'stack' }, items.map(item => button(item.title, quizPage(subject, item.id), 'card list-button'))) : empty('ما في اختبارات منشورة لهذه المادة.'));
    } else {
      const list = el('div', { class: 'stack' });
      let archive = items;
      let search = '';
      const render = () => list.replaceChildren(...archiveView(archive, (item, number) =>
        button('مستند ' + number + ' · ' + item.title, documentPage(subject, item.id), 'card list-button'), undefined, search));
      render();
      content.push(items.page && el('p', { class: 'card class-progress' }, 'تم الوصول إلى صفحة ', el('strong', {}, String(items.page))),
        line('البحث بعنوان الصورة أو المستند', el('input', { type: 'search', oninput: event => { search = event.target.value; render(); } })), list);
      const submissionList = el('div', { class: 'stack', 'aria-live': 'polite' });
      let wasProcessing = false;
      async function refresh() {
        const submissions = await api('/submissions' + query);
        if (page !== current) return;
        submissionList.replaceChildren(...submissions.map(item => el('div', { class: 'row' },
          el('span', {}, statusLabel[item.state]), item.document && button('فتح المستند', documentPage(subject, item.document)))));
        const processing = submissions.some(item => item.state === 'processing');
        if (wasProcessing && !processing) {
          archive = await api('/archive' + query);
          if (page === current) render();
        }
        wasProcessing = processing;
        if (processing) setTimeout(() => {
          if (page === current) refresh().catch(error => { submissionList.textContent = error.message; });
        }, 2500);
      }
      refresh().catch(error => { submissionList.textContent = error.message; });
      const picker = el('input', { name: 'file', type: 'file', accept: 'image/jpeg,image/png,image/webp', required: true });
      content.splice(3, 0, form([el('h2', {}, 'إضافة مصدر'), el('p', {}, 'اختر صورة لصفحة الدرس. يقرأ النظام النص ويفحص تكراره داخل المادة.'), line('اختر صورة من جهازك · حتى 5 ميغابايت', picker)], 'رفع الصورة واستخراج النص', async (data, message, formElement) => {
        const image = await imageFile(data.file);
        const submission = await api('/submissions', { subject: subject.id, image });
        if (submission.state === 'processing') wasProcessing = true;
        formElement.reset();
        await refresh();
      }), submissionList);
    }
    const related = notices.filter(notice => notice.subject === subject.id);
    if (related.length) content.push(el('h2', {}, 'أخبار وتذكيرات المادة'), noticeList(related));
    return content;
  });
}
const documentPage = (subject, id) => display(async () => {
  const item = await api('/document?id=' + id);
  return [button('← المستندات', subjectPage(subject)), heading(item.title, item.subjectName), el('article', { class: 'card prose' },
    el('p', {}, item.body), el('small', {}, 'آخر تعديل · ' + date(item.updated)))];
});
const quizPage = (subject, id) => display(async () => {
  const quiz = await api('/quiz?id=' + id);
  const questions = quiz.questions.map((question, index) => el('fieldset', {}, el('legend', {}, question.text),
    question.options.map((option, optionIndex) => el('label', { class: 'option' },
      el('input', { type: 'radio', name: 'q' + index, value: optionIndex, required: true }), option))));
  return [button('← الاختبارات', subjectPage(subject, 'quizzes')), heading(quiz.title),
    form(questions, 'تسليم الاختبار', async data => {
      const answers = quiz.questions.map((_, index) => Number(data['q' + index]));
      const result = await api('/quiz', { id, answers });
      app.replaceChildren(heading('نتيجتك · ' + result.score + ' / ' + result.total),
        ...quiz.questions.map((question, index) => el('article', { class: 'card' }, el('h2', {}, question.text),
          el('p', {}, 'إجابتك · ' + question.options[answers[index]]),
          el('strong', {}, 'الإجابة الصحيحة · ' + question.options[result.correct[index]]))),
        button('العودة للاختبارات', subjectPage(subject, 'quizzes')));
    })];
});
const suggestions = display(async () => {
  const entries = await api('/my-suggestions');
  return [heading('اقتراحاتي'), form([
    line('اقتراح جديد', el('textarea', { name: 'body', rows: 3, maxlength: 2000, required: true })),
  ], 'إرسال للمالك', async data => {
    await api('/suggestions', { body: data.body });
    await suggestions();
  }), ...entries.map(item => el('article', { class: 'card' },
    el('small', {}, date(item.created)), el('p', { class: 'prose' }, item.body),
    el('strong', {}, item.reply ? 'رد المالك' : 'بانتظار المراجعة'), el('p', { class: 'prose' }, item.reply)))];
});
const notifications = display(async () => {
  const [notices, entries] = await Promise.all([api('/notices'), api('/my-suggestions')]);
  return [heading('الإشعارات'), ...entries.filter(item => item.reply).map(item =>
    button('رد المالك على اقتراحك · ' + item.body, suggestions, 'card list-button')),
    noticeList(notices.filter(item => !item.subject))];
});
const notes = user => display(async () => {
  const subjects = await api('/subjects');
  if (!subjects.length) return [heading('ملاحظاتي'), empty('ما في مواد بعد.')];
  const picker = el('select', { name: 'subject' }, subjects.map(item => el('option', { value: item.id }, item.name)));
  const note = el('textarea', { name: 'note', rows: 6, maxlength: 8000 });
  const key = () => 'school-note:' + user.id + ':' + picker.value;
  const read = () => { note.value = localStorage.getItem(key()) || ''; };
  picker.addEventListener('change', read);
  read();
  return [heading('ملاحظاتي'), form([line('المادة', picker), line('ملاحظتك', note)], 'حفظ على هذا الجهاز', (data, message) => {
    localStorage.setItem(key(), data.note);
    message.textContent = 'حُفظت الملاحظة على هذا الجهاز.';
  })];
});
function ready(user) {
  nav.replaceChildren();
  if (user.temporary) { temporary(ready); return; }
  nav.prepend(button('المواد', home), button('الأخبار والتحديثات', news), button('الإشعارات', notifications), button('اقتراحاتي', suggestions), button('الإعدادات', display(async () => [heading('الإعدادات', user.name), button('نتائجي', results), button('ملاحظاتي المحفوظة', notes(user)), logout()])));
  home();
}
api('/me').then(ready).catch(error => error.status === 401 ? login('student', ready) : errorView(error));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(error => console.warn(error));
