import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const token = () => randomBytes(32).toString('base64url');
const derivePassword = promisify(scrypt);
const usernamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const fail = (status, message) => Object.assign(new Error(message), { status });

// Signaling deliberately does not receive board positions or moves.
export function createSignalingServer({ database = 'accounts.sqlite', origins = [], iceServers = [], turnSecret = '', turnHost = '', now = Date.now } = {}) {
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL)');
  const sessions = new Map(), streams = new Map(), invites = new Map(), games = new Map(), limits = new Map();
  const nameKey = name => name.toLowerCase();
  function connectionServers(name) {
    if (!turnSecret || !turnHost) return iceServers;
    const username = `${Math.floor(now() / 1000) + 3600}:${name}`;
    return [...iceServers, { urls: [`turn:${turnHost}:3478?transport=udp`, `turn:${turnHost}:3478?transport=tcp`], username, credential: createHmac('sha1', turnSecret).update(username).digest('base64') }];
  }
  function authenticate(req) {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const session = sessions.get(bearer);
    if (!session || session.expires <= now()) { sessions.delete(bearer); throw fail(401, '请重新登录'); }
    return session;
  }
  function send(name, data) {
    const stream = streams.get(nameKey(name));
    if (!stream || stream.destroyed) return false;
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  }
  function onlineList() {
    return [...streams.keys()].map(name => ({ name, busy: [...games.values()].some(g => g.members.includes(name)) }));
  }
  function broadcastPresence() { for (const name of streams.keys()) send(name, { type: 'presence', users: onlineList() }); }
  function busy(name) { return [...games.values()].some(g => g.members.includes(name)); }
  function rateLimit(key, max, window = 60_000) {
    const entry = limits.get(key);
    if (!entry || entry.until <= now()) { limits.set(key, { count: 1, until: now() + window }); return; }
    if (++entry.count > max) throw fail(429, '操作太频繁，请稍后重试');
  }
  async function body(req) {
    let size = 0, chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32_768) throw fail(413, '消息过大');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw fail(400, '消息格式错误'); }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin)) throw fail(403, '不允许的客户端来源');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
        res.end(); return;
      }
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') { json(res, 200, { ok: true }); return; }
      if (req.method === 'POST' && ['/register', '/login'].includes(path)) {
        rateLimit(`auth:${req.socket.remoteAddress}`, 15);
        const { name, password } = await body(req);
        if (typeof name !== 'string' || !usernamePattern.test(name) || typeof password !== 'string' || password.length < 10 || password.length > 128)
          throw fail(400, '账号须为 1–32 位字母开头的字母、数字、下划线或短横线；密码须为 10–128 位');
        const canonical = nameKey(name);
        let user = db.prepare('SELECT * FROM users WHERE name = ?').get(canonical);
        if (path === '/register') {
          if (user) throw fail(409, '账号已存在');
          const salt = randomBytes(16).toString('hex');
          const hash = (await derivePassword(password, salt, 64)).toString('hex');
          if (!db.prepare('INSERT OR IGNORE INTO users VALUES (?, ?, ?)').run(canonical, salt, hash).changes) throw fail(409, '账号已存在');
          user = { name: canonical, salt, hash };
        } else {
          const actual = await derivePassword(password, user?.salt ?? 'invalid-account-salt', 64);
          if (!user || !timingSafeEqual(actual, Buffer.from(user.hash, 'hex'))) throw fail(401, '账号或密码错误');
        }
        // One login per account, preventing competing clients from impersonating a side.
        for (const [key, session] of sessions) if (session.name === canonical) sessions.delete(key);
        const previous = streams.get(canonical);
        if (previous) { send(canonical, { type: 'signed-out' }); previous.end(); streams.delete(canonical); }
        const accessToken = token();
        sessions.set(accessToken, { name: canonical, expires: now() + 12 * 60 * 60_000 });
        json(res, 200, { token: accessToken, name: canonical, iceServers: connectionServers(canonical) }); return;
      }
      const session = authenticate(req), name = session.name;
      if (req.method === 'GET' && path === '/events') {
        streams.get(name)?.end();
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        streams.set(name, res);
        send(name, { type: 'ready', name, games: [...games.values()].filter(g => g.members.includes(name)).map(g => ({ ...g, members: undefined })) });
        broadcastPresence();
        req.on('close', () => {
          if (streams.get(name) !== res) return;
          streams.delete(name);
          for (const g of games.values()) if (g.members.includes(name)) send(g.members.find(n => n !== name), { type: 'peer-offline', gameId: g.id });
          broadcastPresence();
        });
        return;
      }
      if (req.method !== 'POST') throw fail(404, '接口不存在');
      rateLimit(`api:${name}`, 240);
      const data = await body(req);
      if (path === '/ice') { json(res, 200, { iceServers: connectionServers(name) }); return; }
      if (path === '/logout') {
        for (const [key, s] of sessions) if (s.name === name) sessions.delete(key);
        streams.get(name)?.end(); json(res, 200, { ok: true }); return;
      }
      if (path === '/invite') {
        rateLimit(`invite:${name}`, 10);
        const to = typeof data.to === 'string' ? nameKey(data.to) : '';
        if (to === name || !streams.has(to) || !streams.has(name)) throw fail(400, '双方需要在线，且不能邀请自己');
        if (busy(name) || busy(to)) throw fail(409, '一方已在对局中');
        const id = randomUUID(), invite = { id, from: name, to, expires: now() + 60_000 };
        invites.set(id, invite); send(to, { type: 'invite', ...invite });
        json(res, 200, { id }); return;
      }
      if (path === '/respond') {
        const invite = invites.get(data.id);
        if (!invite || invite.to !== name || invite.expires <= now()) throw fail(404, '邀请已失效');
        invites.delete(data.id);
        if (data.accept !== true) { send(invite.from, { type: 'declined', id: invite.id }); json(res, 200, { ok: true }); return; }
        if (!streams.has(invite.from) || !streams.has(name) || busy(name) || busy(invite.from)) throw fail(409, '对手已离线或开始另一场对局');
        const game = { id: randomUUID(), members: [invite.from, name], red: invite.from, black: name, created: now() };
        games.set(game.id, game);
        for (const player of game.members) send(player, { type: 'game', gameId: game.id, red: game.red, black: game.black, initiator: player === game.red });
        broadcastPresence(); json(res, 200, { gameId: game.id }); return;
      }
      const game = games.get(data.gameId);
      if (!game || !game.members.includes(name)) throw fail(403, '无权操作该对局');
      const peer = game.members.find(n => n !== name);
      if (path === '/signal') {
        if (!['offer', 'answer', 'candidate', 'restart'].includes(data.kind)) throw fail(400, '信令类型错误');
        if (data.kind !== 'restart' && (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload))) throw fail(400, '信令内容错误');
        if (!send(peer, { type: 'signal', gameId: game.id, from: name, kind: data.kind, payload: data.payload })) throw fail(409, '对手已离线');
        json(res, 200, { ok: true }); return;
      }
      if (path === '/leave') {
        games.delete(game.id); send(peer, { type: 'peer-left', gameId: game.id }); broadcastPresence();
        json(res, 200, { ok: true }); return;
      }
      throw fail(404, '接口不存在');
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : '服务器内部错误' });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  const maintenance = setInterval(() => {
    for (const [key, s] of sessions) if (s.expires <= now()) { sessions.delete(key); streams.get(s.name)?.end(); }
    for (const [key, value] of invites) if (value.expires <= now()) invites.delete(key);
    for (const [key, value] of limits) if (value.until <= now()) limits.delete(key);
    for (const [key, game] of games) if (now() - game.created > 24 * 60 * 60_000) { for (const player of game.members) send(player, { type: 'expired', gameId: key }); games.delete(key); }
    for (const stream of streams.values()) stream.write(': heartbeat\n\n');
  }, 15_000);
  maintenance.unref();
  server.on('close', () => { clearInterval(maintenance); db.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createSignalingServer({
    database: process.env.P2P_DATABASE ?? 'accounts.sqlite',
    origins: (process.env.P2P_ORIGINS ?? 'http://localhost:3000').split(',').filter(Boolean),
    iceServers: JSON.parse(process.env.P2P_ICE_SERVERS ?? '[]'),
    turnSecret: process.env.P2P_TURN_SECRET ?? '', turnHost: process.env.P2P_TURN_HOST ?? '',
  });
  server.listen(Number(process.env.PORT ?? 8790), process.env.HOST ?? '127.0.0.1', () => console.log('弈思信令服务已启动', server.address()));
}
