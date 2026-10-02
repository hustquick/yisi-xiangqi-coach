import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const token = () => randomBytes(32).toString('base64url');
const derivePassword = promisify(scrypt);
const usernamePattern = /^[\p{L}][\p{L}\p{M}\p{N}_-]{0,31}$/u;
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const fail = (status, message) => Object.assign(new Error(message), { status });

// Live moves stay peer-to-peer; explicitly saved personal records are private account resources.
export function createSignalingServer({ database = 'accounts.sqlite', origins = [], iceServers = [], turnSecret = '', turnHost = '', now = Date.now } = {}) {
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS friends (owner TEXT NOT NULL, friend TEXT NOT NULL, PRIMARY KEY (owner, friend))');
  db.exec('CREATE TABLE IF NOT EXISTS friend_requests (sender TEXT NOT NULL, recipient TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(sender,recipient))');
  db.exec('CREATE TABLE IF NOT EXISTS presence_preferences (name TEXT PRIMARY KEY, invisible INTEGER NOT NULL DEFAULT 0)');
  db.exec('CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL)');
  db.exec('INSERT OR IGNORE INTO profiles(name,nickname) SELECT name,name FROM users ORDER BY name');
  const profile = name => {
    const row=db.prepare('SELECT id,nickname FROM profiles WHERE name = ?').get(name);
    return row ? {...row,id:String(row.id).padStart(9,'0')} : null;
  };
  db.exec('CREATE TABLE IF NOT EXISTS game_history (id TEXT PRIMARY KEY, red TEXT NOT NULL, black TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER, result TEXT, duration INTEGER NOT NULL DEFAULT 0)');
  db.exec('CREATE TABLE IF NOT EXISTS game_records (game TEXT PRIMARY KEY, content TEXT NOT NULL)');
  function saveGameRecord(game,content) {
    if(content==null) return;
    const record=content.record;
    if (!Number.isInteger(content.version) || !record || !Array.isArray(record.pieces) || record.pieces.length>32 || !Array.isArray(record.moves) || record.moves.length>1000 || !['red','black'].includes(record.turn)) throw fail(400,'对局棋谱格式错误');
    const serialized=JSON.stringify(content);
    if(Buffer.byteLength(serialized)>24000) throw fail(413,'对局棋谱过大');
    db.prepare('INSERT INTO game_records VALUES (?,?) ON CONFLICT(game) DO UPDATE SET content=excluded.content').run(game.id,serialized);
  }
  function startHistory(game) {
    db.prepare('INSERT INTO game_history(id,red,black,started) VALUES (?,?,?,?)').run(game.id,game.red,game.black,game.created);
  }
  function endHistory(game, result) {
    const ended = now();
    db.prepare('UPDATE game_history SET ended=?,result=?,duration=? WHERE id=? AND ended IS NULL').run(ended,result,Math.max(0,ended-game.created),game.id);
  }
  // A service restart cannot preserve a live peer session; retain its history honestly.
  db.prepare("UPDATE game_history SET ended=?,result='服务中断',duration=MAX(0,?-started) WHERE ended IS NULL").run(now(),now());
  db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL)');
  const sessions = new Map(), streams = new Map(), invites = new Map(), games = new Map(), limits = new Map();
  let closed=false;
  const nameKey = name => name.normalize('NFC').toLowerCase();
  const invisible = name => !!db.prepare('SELECT invisible FROM presence_preferences WHERE name = ?').get(name)?.invisible;
  const visibleOnline = name => streams.has(name) && !invisible(name);
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
  function friendList(owner) {
    return db.prepare('SELECT friend FROM friends WHERE owner = ? ORDER BY friend').all(owner).map(row => ({ name: row.friend, ...profile(row.friend), online: visibleOnline(row.friend), busy: visibleOnline(row.friend) && busy(row.friend) }));
  }
  function friendRequests(name) { return db.prepare('SELECT sender FROM friend_requests WHERE recipient=? ORDER BY created').all(name).map(row=>({name:row.sender,...profile(row.sender)})); }
  function broadcastPresence() { for (const name of streams.keys()) send(name, { type: 'presence', users: friendList(name), requests:friendRequests(name) }); }
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
        if (typeof name !== 'string' || !usernamePattern.test(name))
          throw fail(400, '账号须为1–32个字符，以汉字或其他文字开头，可包含数字、下划线和短横线');
        if (typeof password !== 'string' || password.length === 0 || password.length > 128)
          throw fail(400, '请输入密码，最多 128 个字符；不要求数字、大小写或特殊符号');
        const canonical = nameKey(name);
        let user = db.prepare('SELECT * FROM users WHERE name = ?').get(canonical);
        if (path === '/register') {
          if (user || db.prepare('SELECT 1 FROM profiles WHERE nickname=? COLLATE NOCASE').get(name.normalize('NFC'))) throw fail(409, '账号已存在，请换一个名称');
          if ((db.prepare("SELECT seq FROM sqlite_sequence WHERE name='profiles'").get()?.seq??0)>=999999999) throw fail(503,'账号注册暂不可用');
          const salt = randomBytes(16).toString('hex');
          const hash = (await derivePassword(password, salt, 64)).toString('hex');
          if (!db.prepare('INSERT OR IGNORE INTO users VALUES (?, ?, ?)').run(canonical, salt, hash).changes) throw fail(409, '账号已存在');
          user = { name: canonical, salt, hash };
          db.prepare('INSERT INTO profiles(name,nickname) VALUES (?,?)').run(canonical, canonical);
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
        json(res, 200, { token: accessToken, name: canonical, ...profile(canonical), presence: invisible(canonical) ? 'invisible' : 'online', iceServers: connectionServers(canonical) }); return;
      }
      const session = authenticate(req), name = session.name;
      if (req.method === 'GET' && path === '/events') {
        streams.get(name)?.end();
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        streams.set(name, res);
        send(name, { type: 'ready', name, games: [...games.values()].filter(g => g.members.includes(name)).map(g => ({ id:g.id,red:g.red,black:g.black })) });
        broadcastPresence();
        for (const invite of invites.values()) if (invite.to === name && invite.expires > now()) send(name, { type: 'invite', ...invite });
        req.on('close', () => {
          if(closed) return;
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
      if(path==='/history/get') {
        const row=db.prepare('SELECT r.content FROM game_records r JOIN game_history h ON h.id=r.game WHERE h.id=? AND (h.red=? OR h.black=?) AND h.ended IS NOT NULL').get(typeof data.id==='string'?data.id:'',name,name);
        if(!row) throw fail(404,'该对局暂无完整棋谱');
        json(res,200,{content:JSON.parse(row.content)});return;
      }
      if (path === '/history') {
        const before = Number.isSafeInteger(data.before) ? data.before : now()+1;
        const rows = db.prepare('SELECT * FROM game_history WHERE (red=? OR black=?) AND started<? ORDER BY started DESC,id DESC LIMIT 100').all(name,name,before);
        json(res,200,{games:rows.map(row=>({id:row.id,side:row.red===name?'red':'black',opponent:profile(row.red===name?row.black:row.red),started:row.started,ended:row.ended,result:row.result??'进行中',duration:row.ended===null?Math.max(0,now()-row.started):row.duration}))}); return;
      }
      if (path === '/profile') {
        if (typeof data.nickname !== 'string' || !data.nickname.trim() || data.nickname.trim().length > 32) throw fail(400, '名称须为1–32个字符');
        if (db.prepare('SELECT 1 FROM profiles WHERE (nickname=? COLLATE NOCASE OR name=?) AND name<>?').get(data.nickname.trim(),nameKey(data.nickname.trim()),name)) throw fail(409,'名称已被使用，请换一个名称');
        db.prepare('UPDATE profiles SET nickname=? WHERE name=?').run(data.nickname.trim(),name);
        broadcastPresence(); json(res,200,profile(name)); return;
      }
      if (path === '/records/list') {
        json(res, 200, { records: db.prepare('SELECT id, title, created FROM records WHERE owner = ? ORDER BY created DESC').all(name) }); return;
      }
      if (path === '/records/get') {
        const record = db.prepare('SELECT id, title, content, created FROM records WHERE owner = ? AND id = ?').get(name, typeof data.id === 'string' ? data.id : '');
        if (!record) throw fail(404, '棋谱不存在');
        json(res, 200, { ...record, content: JSON.parse(record.content) }); return;
      }
      if (path === '/records/save') {
        const saved = data.content, record = saved?.record;
        if (!Number.isInteger(saved?.version) || !record || typeof record.title !== 'string' || !record.title.trim() || record.title.length > 120 || !Array.isArray(record.pieces) || record.pieces.length > 32 || !Array.isArray(record.moves) || record.moves.length > 1000 || !['red', 'black'].includes(record.turn)) throw fail(400, '棋谱格式错误');
        const content = JSON.stringify(saved);
        if (Buffer.byteLength(content) > 24_000) throw fail(413, '棋谱过大，请保存到本机');
        if (db.prepare('SELECT COUNT(*) AS count FROM records WHERE owner = ?').get(name).count >= 200) throw fail(409, '云端棋谱已达 200 份上限');
        const id = randomUUID();
        db.prepare('INSERT INTO records (id, owner, title, content, created) VALUES (?, ?, ?, ?, ?)').run(id, name, record.title.trim(), content, now());
        json(res, 200, { id }); return;
      }
      if (path === '/presence') {
        if (!['online', 'invisible'].includes(data.mode)) throw fail(400, '账户状态错误');
        db.prepare('INSERT INTO presence_preferences VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET invisible=excluded.invisible').run(name, data.mode === 'invisible' ? 1 : 0);
        broadcastPresence(); json(res, 200, { presence: data.mode }); return;
      }
      if (path === '/friends') { json(res, 200, { friends: friendList(name) }); return; }
      if (path === '/friends/respond') {
        const sender=typeof data.name==='string'?nameKey(data.name):'';
        if (typeof data.accept!=='boolean') throw fail(400,'请选择同意或拒绝');
        if (!db.prepare('SELECT 1 FROM friend_requests WHERE sender=? AND recipient=?').get(sender,name)) throw fail(404,'好友申请已失效');
        if (data.accept && (friendList(name).length>=200 || friendList(sender).length>=200)) throw fail(409,'好友数量已达上限');
        db.exec('BEGIN');
        try {
          db.prepare('DELETE FROM friend_requests WHERE sender=? AND recipient=?').run(sender,name);
          if(data.accept) { db.prepare('INSERT OR IGNORE INTO friends VALUES (?,?)').run(name,sender); db.prepare('INSERT OR IGNORE INTO friends VALUES (?,?)').run(sender,name); }
          db.exec('COMMIT');
        } catch(error) { db.exec('ROLLBACK'); throw error; }
        broadcastPresence();json(res,200,{friends:friendList(name),requests:friendRequests(name)});return;
      }
      if (path === '/search') {
        rateLimit(`search:${name}`, 30);
        const query = typeof data.name === 'string' ? nameKey(data.name.trim()) : '';
        if (!query || query.length > 32) throw fail(400, '请输入数字ID或完整名称');
        const matches = /^\d+$/.test(query)
          ? db.prepare('SELECT name FROM profiles WHERE id=? AND name<>?').all(query,name)
          : db.prepare('SELECT name FROM profiles WHERE name<>? AND (instr(lower(name),?)>0 OR instr(lower(nickname),?)>0) ORDER BY CASE WHEN lower(nickname)=? THEN 0 ELSE 1 END,id LIMIT 20').all(name,query,query,query);
        const users=matches.map(found=>({ name:found.name,...profile(found.name),online:visibleOnline(found.name),busy:visibleOnline(found.name)&&busy(found.name),added:!!db.prepare('SELECT 1 FROM friends WHERE owner=? AND friend=?').get(name,found.name) }));
        json(res,200,{user:users[0]??null,users});return;
      }
      if (path === '/friends/add' || path === '/friends/remove') {
        const friend = typeof data.name === 'string' ? nameKey(data.name.trim()) : '';
        if (!usernamePattern.test(friend) || friend === name || !db.prepare('SELECT 1 FROM users WHERE name = ?').get(friend)) throw fail(400, '好友账号不存在');
        if (path === '/friends/add') {
          if (friendList(name).length >= 200 && !db.prepare('SELECT 1 FROM friends WHERE owner = ? AND friend = ?').get(name, friend)) throw fail(400, '好友数量已达上限');
          if (!db.prepare('SELECT 1 FROM friends WHERE owner=? AND friend=?').get(name,friend)) {
            rateLimit(`friend-request:${name}`,20);
            if(db.prepare('SELECT COUNT(*) AS count FROM friend_requests WHERE recipient=?').get(friend).count>=200) throw fail(429,'对方申请列表已满');
            db.prepare('INSERT OR IGNORE INTO friend_requests VALUES (?,?,?)').run(name,friend,now());
          }
        } else {
          db.prepare('DELETE FROM friends WHERE (owner=? AND friend=?) OR (owner=? AND friend=?)').run(name,friend,friend,name);
        }
        broadcastPresence();
        json(res, 200, { friends: friendList(name), pending:path==='/friends/add' }); return;
      }
      if (path === '/ice') { json(res, 200, { iceServers: connectionServers(name) }); return; }
      if (path === '/logout') {
        for (const [key, s] of sessions) if (s.name === name) sessions.delete(key);
        streams.get(name)?.end(); json(res, 200, { ok: true }); return;
      }
      if (path === '/invite') {
        rateLimit(`invite:${name}`, 10);
        const side=data.side??'red';
        if(!['red','black'].includes(side)) throw fail(400,'请选择红方或黑方');
        const swapSides=data.swapSides??true;
        if(typeof swapSides!=='boolean') throw fail(400,'换边设置错误');
        const to = typeof data.to === 'string' ? nameKey(data.to) : '';
        if (to === name || !visibleOnline(to) || !streams.has(name)) throw fail(400, '好友当前不在线，或账号不能邀请自己');
        if (busy(name) || busy(to)) throw fail(409, '一方已在对局中');
        if ([...invites.values()].some(invite => invite.from === name && invite.to === to && invite.expires > now())) throw fail(409, '邀请已发出，请等待对手回应');
        const id = randomUUID(), invite = { id, from: name, fromProfile:profile(name), side, swapSides, to, expires: now() + 60_000 };
        invites.set(id, invite); send(to, { type: 'invite', ...invite });
        json(res, 200, { id }); return;
      }
      if (path === '/respond') {
        const invite = invites.get(data.id);
        if (!invite || invite.to !== name || invite.expires <= now()) throw fail(404, '邀请已失效');
        invites.delete(data.id);
        if (data.accept !== true) { send(invite.from, { type: 'declined', id: invite.id }); json(res, 200, { ok: true }); return; }
        if (!streams.has(invite.from) || !streams.has(name) || busy(name) || busy(invite.from)) throw fail(409, '对手已离线或开始另一场对局');
        const game = { id: randomUUID(), members: [invite.from, name], red: invite.side==='black'?name:invite.from, black: invite.side==='black'?invite.from:name, swapSides:invite.swapSides, created: now() };
        games.set(game.id, game);
        startHistory(game);
        for (const player of game.members) send(player, { type: 'game', gameId: game.id, red: game.red, black: game.black, initiator: player === game.red });
        broadcastPresence(); json(res, 200, { gameId: game.id }); return;
      }
      const game = games.get(data.gameId);
      if (!game || !game.members.includes(name)) throw fail(403, '无权操作该对局');
      const peer = game.members.find(n => n !== name);
      if (path === '/next-game') {
        saveGameRecord(game,data.content);
        if (!['red','black','draw'].includes(data.result)) throw fail(400,'对局结果错误');
        game.finished ??= new Map(); game.finished.set(name,data.result);
        if (game.finished.size===2 && new Set(game.finished.values()).size!==1) throw fail(409,'双方结果不一致，请核对局面');
        if (game.finished.size===2) endHistory(game,data.result);
        if (game.finished.size === 2 && !game.nextTimer) game.nextTimer = setTimeout(() => {
          if (games.get(game.id) !== game || !game.members.every(player => streams.has(player))) { game.nextTimer = null; return; }
          games.delete(game.id);
          const next = { id: randomUUID(), members: game.members, red: game.swapSides?game.black:game.red, black: game.swapSides?game.red:game.black, swapSides:game.swapSides, created: now() };
          games.set(next.id,next);
          startHistory(next);
          for (const player of next.members) send(player,{ type:'game',gameId:next.id,red:next.red,black:next.black,initiator:player===next.red });
        },5000);
        json(res,200,{ok:true}); return;
      }
      if (path === '/signal') {
        if (!['offer', 'answer', 'candidate', 'restart'].includes(data.kind)) throw fail(400, '信令类型错误');
        if (data.kind !== 'restart' && (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload))) throw fail(400, '信令内容错误');
        if (!send(peer, { type: 'signal', gameId: game.id, from: name, kind: data.kind, payload: data.payload })) throw fail(409, '对手已离线');
        json(res, 200, { ok: true }); return;
      }
      if (path === '/leave') {
        saveGameRecord(game,data.content);
        clearTimeout(game.nextTimer);
        endHistory(game,`${name===game.red?'red':'black'}-left`);
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
    for (const [key, value] of invites) if (value.expires <= now()) {
      invites.delete(key);
      for (const player of [value.from, value.to]) send(player, { type: 'invite-expired', id: key });
    }
    for (const [key, value] of limits) if (value.until <= now()) limits.delete(key);
    for (const [key, game] of games) if (now() - game.created > 24 * 60 * 60_000) { for (const player of game.members) send(player, { type: 'expired', gameId: key }); games.delete(key); }
    for (const stream of streams.values()) stream.write(': heartbeat\n\n');
  }, 15_000);
  maintenance.unref();
  server.on('close', () => { closed=true; clearInterval(maintenance); for (const game of games.values()) clearTimeout(game.nextTimer); db.close(); });
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
