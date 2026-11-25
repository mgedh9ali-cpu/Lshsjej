const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  // Form submissions need an Origin header; only send referrers within this origin.
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};
const escape = text => String(text).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

function page(message = '', invite = null, status = 200) {
  const result = invite ? `<label>رمز الدعوة <input dir="ltr" readonly value="${escape(invite.invite)}"></label>
    <p>${invite.owner ? "ينتهي رمز اعتماد المالك خلال ١٠ دقائق. أدخله في هاتف المالك فقط." : "ينتهي الرمز خلال ٢٤ ساعة. أرسله مباشرة إلى الطالب المقصود."}</p>` : '';
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>دعوات قوم دروس</title>
    <style>
      body{font:1rem/1.7 system-ui,sans-serif;background:#f1f6f4;color:#173d39;margin:0}
      main{max-width:33rem;margin:auto;padding:1.25rem}
      form,section{background:#fff;border:1px solid #cdded6;border-radius:1rem;padding:1rem;margin:1rem 0}
      label{display:grid;gap:.3rem;margin-bottom:.8rem}
      input,button{font:inherit;border-radius:.6rem;padding:.6rem;min-width:0}
      input{border:1px solid #78968b}
      button{background:#145348;color:white;border:0;cursor:pointer}
    </style>
    <main><h1>دعوات قوم دروس</h1>
    ${message ? `<section><p role="status">${escape(message)}</p>${result}</section>` : ''}
    <form method="post" action="/owner">
      <label>اسم الطالب <input name="name" autocomplete="off" maxlength="100" required></label>
      <label>بريد الطالب <input name="email" type="email" dir="ltr" maxlength="254" required></label>
      <button name="op" value="create-invite">إنشاء دعوة</button>
    </form>
    <form method="post" action="/owner">
      <button name="op" value="create-owner-invite">اعتماد هاتف المالك</button>
    </form>
    <form method="post" action="/owner">
      <label>بريد الطالب <input name="email" type="email" dir="ltr" maxlength="254" required></label>
      <button name="op" value="revoke-invite">إلغاء دعوة معلّقة</button>
    </form></main></html>`, { status, headers });
}

export async function ownerPage(request, env, ctx, handle) {
  if (!env.QUM_ACCESS_AUD || ctx?.access?.aud !== env.QUM_ACCESS_AUD || !env.QUM_ACCESS_OWNER_EMAIL) {
    return new Response('Access required', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const identity = await ctx.access.getIdentity();
  if (identity?.email?.toLowerCase() !== env.QUM_ACCESS_OWNER_EMAIL.toLowerCase()) {
    return new Response('Access denied', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'GET') return page();
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(request.url).origin) {
    return page('تعذّر تنفيذ الطلب.', null, 403);
  }
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded') ||
      Number(request.headers.get('Content-Length')) > 4096) return page('تحقق من البيانات المدخلة.', null, 400);
  const fields = new URLSearchParams(await request.text());
  const op = fields.get('op');
  if (!['create-invite', 'revoke-invite', 'create-owner-invite'].includes(op)) return page('العملية غير متاحة.', null, 400);
  try {
    const result = await handle('Bearer ' + env.QUM_OWNER_KEY, {
      op, name: fields.get('name'), email: fields.get('email'),
    });
    return result.invite ? page('أُنشئت الدعوة.', {...result,owner:op==='create-owner-invite'}) : page('أُلغيت الدعوة.');
  } catch (error) {
    return page(error.status ? error.message : 'تعذّر تنفيذ الطلب على خدمة الصف.', null, error.status || 500);
  }
}
