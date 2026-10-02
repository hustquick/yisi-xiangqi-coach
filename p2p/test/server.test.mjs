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
    assert.equal((await post('/register', { name: 'A', password: '' })).status, 400);
    assert.equal((await post('/register', { name: 'A', password: 'a'.repeat(129) })).status, 400);
    const a = await post('/register', { name: 'A', password: '1' });
    assert.equal(a.status, 200); assert.equal(a.body.name, 'a'); assert.equal(a.body.iceServers.length, 1);
    assert.equal((await post('/register', { name: 'a', password: 'test-password-A' })).status, 409);
    assert.equal((await post('/login', { name: 'A', password: 'wrong-password' })).status, 401);
    assert.equal((await post('/login', { name: 'A', password: 'test-password-A' }, '', 'https://evil.example')).status, 403);
    assert.equal((await post('/signal', { gameId: 'other', kind: 'offer', payload: {} }, a.body.token)).status, 403);
    assert.equal((await post('/invite', { to: 'B' }, a.body.token)).status, 400);
    assert.equal((await post('/ice', {}, a.body.token)).status, 200);
    const b = await post('/register', { name: 'B', password: '2' });
    assert.equal(b.status, 200);
    const content = { version: 1, record: { title: '个人棋谱', pieces: [], turn: 'red', moves: [] }, activePly: 0 };
    const saved = await post('/records/save', { content }, a.body.token);
    assert.equal(saved.status, 200);
    assert.equal((await post('/records/list', {}, a.body.token)).body.records.length, 1);
    assert.equal((await post('/records/list', {}, b.body.token)).body.records.length, 0);
    assert.equal((await post('/records/get', { id: saved.body.id }, b.body.token)).status, 404, '不能读取其他账号棋谱');
    assert.deepEqual((await post('/records/get', { id: saved.body.id }, a.body.token)).body.content, content);
    assert.equal((await post('/records/save', { content: {} }, a.body.token)).status, 400);
    assert.equal((await post('/search', { name: 'b' }, a.body.token)).body.user.online, false);
    assert.equal((await post('/search', { name: 'missing' }, a.body.token)).body.user, null);
    assert.equal((await post('/search', { name: 'a' }, a.body.token)).body.user, null);
    assert.equal((await post('/friends/add', { name: 'B' }, a.body.token)).body.friends[0].name, 'b');
    assert.equal((await post('/friends', {}, b.body.token)).body.friends.length, 0, '每个账号独立保存好友');
    assert.equal((await post('/presence', { mode: 'bad' }, b.body.token)).status, 400);
    assert.equal((await post('/presence', { mode: 'invisible' }, b.body.token)).body.presence, 'invisible');
    const returningB = await post('/login', { name: 'B', password: '2' });
    assert.equal(returningB.body.presence, 'invisible', '重新登录自动保持上次隐身状态');
    const newer = await post('/login', { name: 'A', password: '1' });
    assert.equal(newer.status, 200);
    assert.equal((await post('/friends', {}, newer.body.token)).body.friends[0].name, 'b', '重新登录保留好友');
    assert.equal((await post('/friends/remove', { name: 'b' }, newer.body.token)).body.friends.length, 0);
    assert.equal((await post('/ice', {}, a.body.token)).status, 401);
    assert.equal((await post('/logout', {}, newer.body.token)).status, 200);
    assert.equal((await post('/ice', {}, newer.body.token)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
