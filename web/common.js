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
  const response = await fetch('/api' + path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
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
  app.replaceChildren(heading('تعذّر فتح الصفحة'), empty(error.message));
}
export function login(area, ready) {
  nav.replaceChildren();
  app.replaceChildren(heading(area === 'admin' ? 'دخول الإدارة' : 'أهلًا بك في منصة الدفعة', 'سجّل الدخول بالحساب الذي استلمته.'),
    form([
      line('اسم المستخدم', input('username', { autocomplete: 'username', required: true, dir: 'ltr' })),
      line('كلمة المرور', input('password', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' })),
      area === 'admin' && line('رمز التحقق للمالك', input('code', { inputmode: 'numeric', autocomplete: 'one-time-code', dir: 'ltr', maxlength: 6 })),
    ].filter(Boolean), 'دخول', async data => ready(await api('/login', data))));
}
export function temporary(ready) {
  app.replaceChildren(heading('حدّث كلمة المرور المؤقتة'),
    form([line('كلمة مرور جديدة · 12 محرفًا على الأقل', input('password', { type: 'password', autocomplete: 'new-password', minlength: 12, required: true }))],
      'حفظ ومتابعة', async data => { await api('/password', data); ready(await api('/me')); }));
}
export const logout = () => button('خروج', async () => { try { await api('/logout', {}); location.reload(); } catch (error) { errorView(error); } });
