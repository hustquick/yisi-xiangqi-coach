import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSignalingServer } from '../server.mjs';

test('注册、密码验证、来源限制与对局权限', async () => {
  const server = createSignalingServer({ database: ':memory:', origins: ['http://localhost:3000'], turnHost: '127.0.0.1', turnSecret: 'test-secret-only' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, data, token = '', origin = 'http://localhost:3000') {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` }, body: JSON.stringify(data) });
    return { status: r.status, body: await r.json() };
  }
  try {
    assert.equal((await post('/register', { name: 'A', password: 'short' })).status, 400);
    const a = await post('/register', { name: 'A', password: 'test-password-A' });
    assert.equal(a.status, 200); assert.equal(a.body.name, 'a'); assert.equal(a.body.iceServers.length, 1);
    assert.equal((await post('/register', { name: 'a', password: 'test-password-A' })).status, 409);
    assert.equal((await post('/login', { name: 'A', password: 'wrong-password' })).status, 401);
    assert.equal((await post('/login', { name: 'A', password: 'test-password-A' }, '', 'https://evil.example')).status, 403);
    assert.equal((await post('/signal', { gameId: 'other', kind: 'offer', payload: {} }, a.body.token)).status, 403);
    assert.equal((await post('/invite', { to: 'B' }, a.body.token)).status, 400);
    assert.equal((await post('/ice', {}, a.body.token)).status, 200);
    const newer = await post('/login', { name: 'A', password: 'test-password-A' });
    assert.equal(newer.status, 200);
    assert.equal((await post('/ice', {}, a.body.token)).status, 401);
    assert.equal((await post('/logout', {}, newer.body.token)).status, 200);
    assert.equal((await post('/ice', {}, newer.body.token)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
