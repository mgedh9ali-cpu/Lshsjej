self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>قوم دروس</title><h1>الاتصال غير متاح</h1><p>اتصل بالإنترنت ثم أعد فتح التطبيق.</p></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )));
});
