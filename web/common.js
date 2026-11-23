export const app = document.querySelector('#app');
export const nav = document.querySelector('#nav');
export function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.flat().filter(child => child != null && child !== false));
  return element;
}
export const button = (label, click, className = 'secondary', attrs = {}) =>
  el('button', { type: 'button', class: className, ...attrs, onclick: click }, label);
export const heading = (title, subtitle) => el('section', { class: 'hero' }, el('h1', {}, title), subtitle && el('p', {}, subtitle));
export const line = (label, control) => el('label', { class: 'field' }, label, control);
export const input = (name, props = {}) => el('input', { name, ...props });
export const select = (name, items) => el('select', { name }, items.map(([value, label]) => el('option', { value }, label)));
export const empty = message => el('p', { class: 'empty' }, message);
export const date = value => new Intl.DateTimeFormat('ar-SY', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
export async function api(path, data) {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === '/accounts' && data ? 35000 : 15000);
  try {
    response = await fetch('/api' + path, {
      signal: controller.signal,
      ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });
  } catch {
    throw Error('تعذّر الاتصال بالخادم. تحقق من الرابط والاتصال ثم حاول مجددًا.');
  } finally { clearTimeout(timeout); }
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw Error('عنوان الخادم غير صحيح أو الخدمة غير متاحة.');
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error), { status: response.status });
  return result;
}
export function form(fields, label, submit) {
  const message = el('p', { role: 'status', class: 'message' });
  const send = el('button', { class: 'primary', type: 'submit' }, label);
  return el('form', { class: 'card form', onsubmit: async event => {
    event.preventDefault();
    send.disabled = true;
    send.textContent = 'جارٍ التنفيذ…';
    message.textContent = '';
    try { await submit(Object.fromEntries(new FormData(event.currentTarget)), message, event.currentTarget); }
    catch (error) { message.textContent = error.message; }
    finally { send.disabled = false; send.textContent = label; }
  } }, fields, send, message);
}
export function errorView(error) {
  if (error.status === 401) { location.reload(); return; }
  app.replaceChildren(heading('تعذّر فتح الصفحة'), empty(error.message), button('إعادة المحاولة', () => location.reload(), 'primary'));
}
export function login(area, ready) {
  nav.replaceChildren();
  if (area === 'student') {
    app.replaceChildren(el('div', { class: 'simple-login' }, form([
      el('h1', {}, 'تسجيل الدخول'),
      location.protocol === 'https:' && !navigator.userAgent.includes('QumDorousAndroid') && el('a', { href: 'qumdorous://join?school=' + encodeURIComponent(location.origin) }, 'فتح الصف في تطبيق أندرويد'),
      line('الاسم', input('name', { autocomplete: 'username', required: true })),
      line('كلمة السر', input('password', { type: 'password', autocomplete: 'current-password', required: true })),
    ], 'دخول', async data => ready(await api('/login', data)))));
    return;
  }
  app.replaceChildren(el('div', { class: 'login-layout' },
    el('section', { class: 'hero login-hero' },
      el('img', { src: '/icon-192.png', alt: '', width: 88, height: 88 }),
      el('h1', {}, area === 'admin' ? 'لوحة إدارة قوم دروس' : 'قوم دروس'),
      el('p', {}, area === 'admin' ? 'أدر المحتوى والحسابات من مكان واحد.' : 'موادك ومستنداتك واختباراتك في مكان واحد.')),
    form([el('h2', {}, 'تسجيل الدخول'),
      line('اسم المستخدم', input('username', { autocomplete: 'username', required: true, dir: 'ltr' })),
      line('كلمة المرور', input('password', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' })),
      area === 'admin' && line('رمز التحقق للمالك', input('code', { inputmode: 'numeric', autocomplete: 'one-time-code', dir: 'ltr', maxlength: 6 })),
    ].filter(Boolean), 'دخول', async data => ready(await api('/login', data)))));
}
export function temporary(ready) {
  app.replaceChildren(heading('حدّث كلمة المرور المؤقتة'),
    form([line('كلمة مرور جديدة · 12 محرفًا على الأقل', input('password', { type: 'password', autocomplete: 'new-password', minlength: 12, required: true }))],
      'حفظ ومتابعة', async data => { await api('/password', data); ready(await api('/me')); }));
}
export const logout = () => button('خروج', async () => { try { await api('/logout', {}); location.reload(); } catch (error) { errorView(error); } });

const archiveDate = new Intl.DateTimeFormat('ar-SY-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export function archiveView(archive, openDocument, removeImage, filter = '') {
  const days = new Map();
  function add(item, build) {
    if (!days.has(item.day)) days.set(item.day, []);
    const entry = build();
    if (entry) days.get(item.day).push(entry);
  }
  const query = filter.trim().toLocaleLowerCase();
  const documentNumbers = new Map();
  for (const item of archive.documents) {
    const number = (documentNumbers.get(item.day) || 0) + 1;
    documentNumbers.set(item.day, number);
    if (item.title.toLocaleLowerCase().includes(query)) add(item, () => openDocument(item, number));
  }
  for (const image of archive.images) {
    if (!image.title.toLocaleLowerCase().includes(query)) continue;
    add(image, () => {
      const label = 'صورة ' + image.number + (image.title ? ' · ' + image.title : '');
      const url = '/archive-image?id=' + image.id;
      return el('figure', { class: 'archive-image' },
        el('details', {}, el('summary', {}, label),
          el('img', { src: url, alt: label, loading: 'lazy', decoding: 'async' })),
        removeImage?.(image));
    });
  }
  const groups = [...days].sort(([a], [b]) => b.localeCompare(a)).filter(([, entries]) => entries.length);
  return groups.length ? groups.map(([day, entries]) => el('section', { class: 'card archive-day' },
    el('h2', {}, archiveDate.format(new Date(day + 'T12:00:00Z'))), el('div', { class: 'stack' }, entries))) : [empty('ما في صور أو مستندات مطابقة.')];
}

export function imageFile(file) {
  if (!file?.size) throw Error('اختر صورة.');
  if (file.size > 5_000_000) throw Error('الحد الأقصى للصورة 5 ميغابايت.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('تعذّرت قراءة الصورة.'));
    reader.readAsDataURL(file);
  });
}
