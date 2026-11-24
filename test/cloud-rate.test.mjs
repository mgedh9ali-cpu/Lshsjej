import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../cloud/worker.mjs';

const invite = 'i'.repeat(32);
const device = 'd'.repeat(43);
const authorize = ['Bearer ' + invite, 'Device ' + device];
const request = (authorization, op) => new Request('https://example.test/v1/classroom', {
  method: 'POST',
  headers: { Authorization: authorization, 'CF-Connecting-IP': '192.0.2.1' },
  body: JSON.stringify({ op, device }),
});

test('both student credentials share the IP limit for sync and suggestions', async () => {
  const env = { STUDENT_RATE: { limit: async ({ key }) => {
    assert.equal(key, '192.0.2.1');
    return { success: false };
  } } };
  for (const authorization of authorize) {
    for (const op of ['sync', 'suggest']) {
      assert.equal((await worker.fetch(request(authorization, op), env)).status, 429);
    }
  }
});

test('both student credentials share the suggestion limit before database writes', async () => {
  const keys = [];
  const env = {
    QUM_OWNER_KEY: 'o'.repeat(32),
    QUM_STUDENT_KEY: invite,
    STUDENT_RATE: { limit: async () => ({ success: true }) },
    SUGGESTION_RATE: { limit: async ({ key }) => {
      keys.push(key);
      return { success: false };
    } },
  };
  for (const authorization of authorize) {
    assert.equal((await worker.fetch(request(authorization, 'suggest'), env)).status, 429);
  }
  assert.equal(keys.length, 2);
  assert.match(keys[0], /^[a-f0-9]{64}$/);
  assert.equal(keys[0], keys[1]);
});
