import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const maximumSize = 600_000_000;
const partSize = 8 * 1024 * 1024;
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const unavailable = () => fail(503, 'تخزين الملفات الكبيرة قيد الإعداد.');
const invalid = () => fail(400, 'بيانات رفع الملف غير صالحة.');

export function sourceFiles(bucket, secret) {
  const storage = () => bucket || unavailable();
  const sign = text => createHmac('sha256', secret).update(text).digest();
  function readSession(token, publisher) {
    if (typeof token !== 'string' || token.length > 4096) invalid();
    const [payload, signature, extra] = token.split('.');
    if (!payload || extra !== undefined || !/^[\w-]{43}$/.test(signature || '')) invalid();
    if (!timingSafeEqual(sign(payload), Buffer.from(signature, 'base64url'))) invalid();
    const session = JSON.parse(Buffer.from(payload, 'base64url'));
    if (session.publisher !== publisher || session.expires <= Date.now()) invalid();
    return session;
  }
  const resume = session => storage().resumeMultipartUpload(session.key, session.uploadId);
  return {
    async start(data, publisher) {
      const { size, name, title, subject, requestId } = data;
      if (!Number.isSafeInteger(size) || size < 1 || size > maximumSize)
        fail(413, 'حجم الملف يجب ألا يتجاوز ٦٠٠ ميغابايت.');
      if (/[\x00-\x1f\x7f/\\]/.test(name)) invalid();
      const key = 'sources/' + randomUUID();
      const upload = await storage().createMultipartUpload(key);
      const session = { key, uploadId: upload.uploadId, publisher, size, name, title, subject, requestId,
        expires: Date.now() + 24 * 60 * 60 * 1000 };
      const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
      return { upload: payload + '.' + sign(payload).toString('base64url'), partSize };
    },
    async part(data, publisher, request) {
      const session = readSession(data.upload, publisher);
      const { number } = data;
      const expected = Math.min(partSize, session.size - (number - 1) * partSize);
      if (!Number.isSafeInteger(number) || number < 1 || expected < 1 ||
          Number(request.headers.get('Content-Length')) !== expected || !request.body) invalid();
      const reader = request.body.getReader();
      const bytes = new Uint8Array(expected);
      let offset = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength > expected - offset) {
          await reader.cancel();
          invalid();
        }
        bytes.set(value, offset);
        offset += value.byteLength;
      }
      if (offset !== expected) invalid();
      return resume(session).uploadPart(number, bytes);
    },
    async finish(data, publisher, save) {
      const session = readSession(data.upload, publisher);
      const { parts } = data;
      if (!Array.isArray(parts) || parts.length !== Math.ceil(session.size / partSize) ||
          !parts.every((part, index) => part?.partNumber === index + 1 &&
            typeof part.etag === 'string' && part.etag.length > 0 && part.etag.length <= 128)) invalid();
      let object = await storage().head(session.key);
      if (!object) {
        try { object = await resume(session).complete(parts); }
        catch (error) {
          object = await storage().head(session.key);
          if (!object) throw error;
        }
      }
      if (object.size !== session.size) invalid();
      return save(session, { name: session.name, key: session.key, size: session.size });
    },
    async abort(data, publisher) {
      await resume(readSession(data.upload, publisher)).abort();
      return {};
    },
    async download(file) {
      const object = await storage().get(file.key);
      if (!object) fail(404, 'الملف غير موجود.');
      return new Response(object.body, { headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(object.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      } });
    },
    remove: key => storage().delete(key),
  };
}
