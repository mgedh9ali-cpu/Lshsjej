import { app, nav, el, button, heading, line, api, form, login, temporary, logout, empty, errorView, date } from './common.js';

let page = 0;
const display = fn => async () => {
  const current = ++page;
  try {
    const content = await fn(current);
    if (current === page) app.replaceChildren(...content);
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
const news = display(async () => [heading('الأخبار والتذكيرات'), noticeList(await api('/notices'))]);
const results = display(async () => {
  const items = await api('/results');
  return [heading('نتائجي'), items.length ? el('div', { class: 'stack' }, items.map(item =>
    el('article', { class: 'card row' }, el('strong', {}, item.title), el('bdi', {}, item.score + ' / ' + item.total), el('small', {}, date(item.created))))) : empty('نتائج اختباراتك بتظهر هون.')];
});
const statusLabel = { processing: 'قيد المعالجة', published: 'نُشر المستند', duplicate: 'هذا الموضوع موجود مسبقًا', unreadable: 'الصورة غير واضحة أو لا تحتوي على مستند دراسي', failed: 'تعذّرت المعالجة. جرّب رفع الصورة مجددًا.' };
function subjectPage(subject, tab = 'documents') {
  return display(async current => {
    const query = '?subject=' + subject.id;
    const [items, notices] = await Promise.all([api('/' + tab + query), api('/notices')]);
    const controls = el('div', { class: 'actions', role: 'group', 'aria-label': 'أقسام المادة' },
      button('المستندات', subjectPage(subject), 'secondary', { 'aria-pressed': String(tab === 'documents') }),
      button('الاختبارات', subjectPage(subject, 'quizzes'), 'secondary', { 'aria-pressed': String(tab === 'quizzes') }));
    const content = [button('← المواد', home), heading(subject.name), controls];
    if (tab === 'quizzes') {
      content.push(items.length ? el('div', { class: 'stack' }, items.map(item => button(item.title, quizPage(subject, item.id), 'card list-button'))) : empty('ما في اختبارات منشورة لهذه المادة.'));
    } else {
      const list = el('div', { class: 'stack' });
      const render = (filter = '') => {
        const matched = items.filter(item => item.title.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
        list.replaceChildren(...(matched.length ? matched.map(item => button(item.title, documentPage(subject, item.id), 'card list-button')) : [empty('ما في مستندات مطابقة.')]));
      };
      render();
      content.push(line('البحث بعنوان المستند', el('input', { type: 'search', oninput: event => render(event.target.value) })), list);
      const submissionList = el('div', { class: 'stack', 'aria-live': 'polite' });
      async function refresh() {
        const submissions = await api('/submissions' + query);
        if (page !== current) return;
        submissionList.replaceChildren(...submissions.map(item => el('div', { class: 'row' },
          el('span', {}, statusLabel[item.state]), item.document && button('فتح المستند', documentPage(subject, item.document)))));
        if (submissions.some(item => item.state === 'processing')) setTimeout(() => {
          if (page === current) refresh().catch(error => { submissionList.textContent = error.message; });
        }, 2500);
      }
      refresh().catch(error => { submissionList.textContent = error.message; });
      const picker = el('input', { name: 'file', type: 'file', accept: 'image/jpeg,image/png,image/webp', required: true });
      content.push(el('h2', {}, 'مساهماتي'), form([line('اختر صورة من جهازك · حتى 5 ميغابايت', picker)], 'رفع المساهمة', async (data, message, formElement) => {
        if (data.file.size > 5_000_000) throw Error('الحد الأقصى للصورة 5 ميغابايت.');
        const image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(Error('تعذّرت قراءة الصورة.'));
          reader.readAsDataURL(data.file);
        });
        await api('/submissions', { subject: subject.id, image });
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
function ready(user) {
  nav.replaceChildren(el('span', { class: 'identity' }, user.name), logout());
  if (user.temporary) { temporary(ready); return; }
  nav.prepend(button('المواد', home), button('الأخبار والتذكيرات', news), button('نتائجي', results));
  home();
}
api('/me').then(ready).catch(error => error.status === 401 ? login('student', ready) : errorView(error));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(error => console.warn(error));
