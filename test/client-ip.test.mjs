import assert from 'node:assert/strict';
import test from 'node:test';
import { clientIp } from '../lib/client-ip.mjs';

test('only the configured direct proxy can supply a single validated client address', () => {
  const proxy = '172.30.218.2';
  const request = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: { 'x-forwarded-for': forwarded } });
  assert.equal(clientIp(request('192.0.2.1', '192.0.2.100'), proxy), '192.0.2.1');
  assert.equal(clientIp(request(proxy, '192.0.2.100')), proxy);
  assert.equal(clientIp(request(proxy, '192.0.2.1, 192.0.2.100'), proxy), proxy);
  assert.equal(clientIp(request(proxy, '192.0.2.1:54000'), proxy), proxy);
  assert.equal(clientIp(request('::ffff:' + proxy, '192.0.2.1'), proxy), '192.0.2.1');
  assert.equal(clientIp(request(proxy, '2001:db8::1'), proxy), '2001:db8::1');
});
