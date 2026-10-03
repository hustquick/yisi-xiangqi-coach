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
export function createSignalingServer({ database = 'accounts.sqlite', origins = [], iceServers = [], turnSecret = '', turnHost = '', now = Date.now, disconnectTimeoutMs=300000 } = {}) {
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
  const historyColumns=db.prepare('PRAGMA table_info(game_history)').all().map(row=>row.name);
  for(const column of ['red_moved','black_moved']) if(!historyColumns.includes(column)) db.exec(`ALTER TABLE game_history ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`);
  function saveGameRecord(game,content) {
    if(content==null) return;
    const record=content.record;
    if (!Number.isInteger(content.version) || !record || !Array.isArray(record.pieces) || record.pieces.length>32 || !Array.isArray(record.moves) || record.moves.length>1000 || !['red','black'].includes(record.turn)) throw fail(400,'对局棋谱格式错误');
    const serialized=JSON.stringify(content);
    if(Buffer.byteLength(serialized)>24000) throw fail(413,'对局棋谱过大');
    db.prepare('INSERT INTO game_records VALUES (?,?) ON CONFLICT(game) DO UPDATE SET content=excluded.content').run(game.id,serialized);
  }
  function startHistory(game) {
    db.prepare('INSERT INTO game_history(id,red,black,started,red_moved,black_moved) VALUES (?,?,?,?,0,0)').run(game.id,game.red,game.black,game.created);
  }
  function endHistory(game, result) {
    if(!game.moved?.red || !game.moved?.black) {
      db.prepare('DELETE FROM game_records WHERE game=?').run(game.id);
      db.prepare('DELETE FROM game_history WHERE id=?').run(game.id);
      return;
    }
    const ended = now();
    db.prepare('UPDATE game_history SET ended=?,result=?,duration=? WHERE id=? AND ended IS NULL').run(ended,result,Math.max(0,ended-game.created),game.id);
  }
  function matchup(name,peer) {
    const rows=db.prepare("SELECT red,black,result FROM game_history WHERE ((red=? AND black=?) OR (red=? AND black=?)) AND ended IS NOT NULL AND result IN ('red','black','draw')").all(name,peer,peer,name);
    let wins=0,losses=0,draws=0;
    for(const row of rows) { if(row.result==='draw') draws++; else if(row[row.result]===name) wins++; else losses++; }
    return {opponent:profile(peer),total:rows.length,wins,losses,draws};
  }
  // A service restart cannot preserve a live peer session; retain its history honestly.
  db.exec('DELETE FROM game_records WHERE game IN (SELECT id FROM game_history WHERE ended IS NULL AND (red_moved=0 OR black_moved=0)); DELETE FROM game_history WHERE ended IS NULL AND (red_moved=0 OR black_moved=0)');
  db.prepare("UPDATE game_history SET ended=?,result='服务中断',duration=MAX(0,?-started) WHERE ended IS NULL").run(now(),now());
  db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL)');
  const sessions = new Map(), streams = new Map(), invites = new Map(), games = new Map(), limits = new Map();
  const offlineTimers=new Map();
  const watching=new Map();
  function publishWatch(game) {
    for(const [observer,friend] of watching) {
      if(!game.members.includes(friend)) continue;
      if(!streams.has(observer) || !visibleOnline(friend) || !db.prepare('SELECT 1 FROM friends WHERE owner=? AND friend=?').get(observer,friend)) {watching.delete(observer);continue;}
      send(observer,{type:'watch-state',name:friend,gameId:game.id,content:game.snapshot??null,selected:game.selected??null});
    }
  }
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
  function clockState(game) {
    const used={...game.used};
    if(!game.result) used[game.clockTurn]+=Math.max(0,now()-game.clockAt);
    return {limit:game.limitMs,used,turn:game.clockTurn,ended:!!game.result};
  }
  function armClock(game) {
    clearTimeout(game.clockTimer);
    game.clockTimer=setTimeout(()=>{
      if(games.get(game.id)===game && !game.result) finishGame(game,game.clockTurn==='red'?'black':'red');
    },Math.max(1,game.limitMs-game.used[game.clockTurn]));
    game.clockTimer.unref?.();
  }
  function initClock(game) {
    game.limitMs??=900000;game.used={red:0,black:0};game.moved={red:false,black:false};game.clockTurn='red';game.clockAt=now();game.clockPly=0;armClock(game);
  }
  function closeGame(game,name,reason='left') {
    clearTimeout(game.nextTimer);clearTimeout(game.clockTimer); games.delete(game.id);
    endHistory(game,`${name===game.red?'red':'black'}-left`);
    const peer=game.members.find(player=>player!==name);
    send(peer,{type:'peer-left',gameId:game.id,reason,stats:matchup(peer,name)});
    broadcastPresence();
  }
  function finishGame(game,result) {
    if(game.result) return;
    game.used[game.clockTurn]+=Math.max(0,now()-game.clockAt);clearTimeout(game.clockTimer);
    game.result=result;endHistory(game,result);
    for(const player of game.members) send(player,{type:'round-finished',gameId:game.id,result,stats:matchup(player,game.members.find(n=>n!==player))});
    game.nextTimer=setTimeout(()=>{
      if(games.get(game.id)!==game) return;
      if(!game.members.every(player=>streams.has(player))) {closeGame(game,game.members.find(player=>!streams.has(player)));return;}
      games.delete(game.id);
      const next={id:randomUUID(),members:game.members,red:game.swapSides?game.black:game.red,black:game.swapSides?game.red:game.black,swapSides:game.swapSides,created:now()};
      next.limitMs=game.baseLimitMs??game.limitMs;games.set(next.id,next);initClock(next);next.baseLimitMs=next.limitMs;startHistory(next);
      for(const player of next.members) send(player,{type:'game',gameId:next.id,red:next.red,black:next.black,initiator:player===next.red});
    },5000);
  }
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
        for(const game of [...games.values()]) if(game.members.includes(canonical)) closeGame(game,canonical);
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
        clearTimeout(offlineTimers.get(name));offlineTimers.delete(name);
        for(const g of games.values()) if(g.members.includes(name)) send(g.members.find(n=>n!==name),{type:'peer-online',gameId:g.id});
        send(name, { type: 'ready', name, games: [...games.values()].filter(g => g.members.includes(name)).map(g => ({ id:g.id,red:g.red,black:g.black,content:g.snapshot??null })) });
        broadcastPresence();
        for (const invite of invites.values()) if (invite.to === name && invite.expires > now()) send(name, { type: 'invite', ...invite });
        req.on('close', () => {
          if(closed) return;
          if (streams.get(name) !== res) return;
          streams.delete(name);
          for (const g of games.values()) if (g.members.includes(name)) send(g.members.find(n => n !== name), { type: 'peer-offline', gameId: g.id });
          clearTimeout(offlineTimers.get(name));
          const offlineTimer=setTimeout(()=>{
            if(offlineTimers.get(name)!==offlineTimer)return;
            offlineTimers.delete(name);
            if(!closed && !streams.has(name)) for(const game of [...games.values()]) if(game.members.includes(name)) closeGame(game,name,'disconnect-timeout');
          },disconnectTimeoutMs);
          offlineTimers.set(name,offlineTimer);
          offlineTimer.unref();
          broadcastPresence();
        });
        return;
      }
      if (req.method !== 'POST') throw fail(404, '接口不存在');
      rateLimit(`api:${name}`, 240);
      const data = await body(req);
      if(path==='/watch') {
        const friend=typeof data.name==='string'?nameKey(data.name):'';
        if(busy(name)) throw fail(409,'请先退出自己的对局');
        if(!visibleOnline(friend) || !db.prepare('SELECT 1 FROM friends WHERE owner=? AND friend=?').get(name,friend)) throw fail(403,'只能观看在线好友的对局');
        const game=[...games.values()].find(g=>g.members.includes(friend));
        if(!game) throw fail(404,'好友对局已结束');
        watching.set(name,friend);
        json(res,200,{gameId:game.id,content:game.snapshot??null,selected:game.selected??null});return;
      }
      if(path==='/history/get') {
        const row=db.prepare('SELECT r.content FROM game_records r JOIN game_history h ON h.id=r.game WHERE h.id=? AND (h.red=? OR h.black=?) AND h.ended IS NOT NULL').get(typeof data.id==='string'?data.id:'',name,name);
        if(!row) throw fail(404,'该对局暂无完整棋谱');
        json(res,200,{content:JSON.parse(row.content)});return;
      }
      if (path === '/history') {
        const before = Number.isSafeInteger(data.before) ? data.before : now()+1;
        const peer = data.opponentId == null ? null : db.prepare('SELECT name FROM profiles WHERE id=?').get(String(data.opponentId))?.name;
        if(data.opponentId!=null && !peer) throw fail(404,'对手不存在');
        const rows = peer ? db.prepare('SELECT * FROM game_history WHERE ((red=? AND black=?) OR (red=? AND black=?)) AND started<? ORDER BY started DESC,id DESC LIMIT 100').all(name,peer,peer,name,before) : db.prepare('SELECT * FROM game_history WHERE (red=? OR black=?) AND started<? ORDER BY started DESC,id DESC LIMIT 100').all(name,name,before);
        json(res,200,{games:rows.map(row=>({id:row.id,side:row.red===name?'red':'black',opponent:profile(row.red===name?row.black:row.red),started:row.started,ended:row.ended,hasRecord:!!db.prepare('SELECT 1 FROM game_records WHERE game=?').get(row.id),result:row.result??'进行中',duration:row.ended===null?Math.max(0,now()-row.started):row.duration}))}); return;
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
      if (path === '/ice') { json(res, 200, { ...profile(name),presence:invisible(name)?'invisible':'online',iceServers: connectionServers(name) }); return; }
      if (path === '/logout') {
        for(const game of [...games.values()]) if(game.members.includes(name)) closeGame(game,name);
        for (const [key, s] of sessions) if (s.name === name) sessions.delete(key);
        streams.get(name)?.end(); json(res, 200, { ok: true }); return;
      }
      if (path === '/invite') {
        rateLimit(`invite:${name}`, 10);
        const side=data.side??'red';
        if(!['red','black'].includes(side)) throw fail(400,'请选择红方或黑方');
        const swapSides=data.swapSides??true;
        const minutes=data.minutes??15;
        if(![5,10,15,30,45].includes(minutes)) throw fail(400,'局时设置错误');
        if(typeof swapSides!=='boolean') throw fail(400,'换边设置错误');
        const to = typeof data.to === 'string' ? nameKey(data.to) : '';
        if (to === name || !visibleOnline(to) || !streams.has(name)) throw fail(400, '好友当前不在线，或账号不能邀请自己');
        if (busy(name) || busy(to)) throw fail(409, '一方已在对局中');
        if ([...invites.values()].some(invite => invite.from === name && invite.to === to && invite.expires > now())) throw fail(409, '邀请已发出，请等待对手回应');
        const id = randomUUID(), invite = { id, from: name, fromProfile:profile(name), side, swapSides, minutes, to, expires: now() + 60_000 };
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
        game.limitMs=invite.minutes*60000;game.baseLimitMs=game.limitMs;initClock(game);
        startHistory(game);
        for (const player of game.members) send(player, { type: 'game', gameId: game.id, red: game.red, black: game.black, initiator: player === game.red });
        broadcastPresence(); json(res, 200, { gameId: game.id }); return;
      }
      const game = games.get(data.gameId);
      if (!game || !game.members.includes(name)) throw fail(403, '无权操作该对局');
      const peer = game.members.find(n => n !== name);
      if(!game.result && clockState(game).used[game.clockTurn]>=game.limitMs) finishGame(game,game.clockTurn==='red'?'black':'red');
      if(path==='/time/offer') {
        if(game.limitMs>=2700000) throw fail(409,'局时已达45分钟上限');
        if(game.result || game.timeOffer) throw fail(409,'已有加时申请或本局已结束');
        if(!send(peer,{type:'time-offer',gameId:game.id})) throw fail(409,'对方离线');
        game.timeOffer=name;json(res,200,{ok:true});return;
      }
      if(path==='/time/respond') {
        if(game.result || game.timeOffer!==peer || typeof data.accept!=='boolean') throw fail(400,'加时申请已失效');
        game.timeOffer=null;
        if(data.accept) {
          game.limitMs=Math.min(2700000,game.limitMs+300000);
          game.used[game.clockTurn]+=Math.max(0,now()-game.clockAt);game.clockAt=now();armClock(game);
        }
        for(const player of game.members)send(player,{type:'time-result',gameId:game.id,accepted:data.accept});
        json(res,200,{ok:true});return;
      }
      if(path==='/undo/offer') {
        if(game.result || game.undoOffer || game.clockPly<1) throw fail(409,'当前不能申请悔棋');
        if(data.content?.record?.moves?.length!==game.clockPly) throw fail(409,'棋谱同步中，请稍后重试');
        saveGameRecord(game,data.content);game.snapshot=data.content;
        game.undoOffer={from:name,ply:game.clockPly};
        send(peer,{type:'undo-offer',gameId:game.id});json(res,200,{ok:true});return;
      }
      if(path==='/undo/respond') {
        if(game.result || game.undoOffer?.from!==peer || typeof data.accept!=='boolean') throw fail(400,'悔棋申请已失效');
        const offer=game.undoOffer;game.undoOffer=null;
        if(data.accept && offer.ply!==game.clockPly) throw fail(409,'局面已变化，请重新申请');
        if(data.accept) {
          game.used[game.clockTurn]+=Math.max(0,now()-game.clockAt);
          game.clockPly--;game.clockTurn=game.clockTurn==='red'?'black':'red';game.clockAt=now();armClock(game);
          game.snapshot.record.moves.pop();saveGameRecord(game,game.snapshot);
          for(const player of game.members) send(player,{type:'undo-applied',gameId:game.id,content:game.snapshot});
          game.selected=null;publishWatch(game);
        } else send(peer,{type:'undo-declined',gameId:game.id});
        json(res,200,{ok:true});return;
      }
      if(path==='/clock' || path==='/clock/move') {
        if(path==='/clock/move' && !game.result) {
          if(data.ply===game.clockPly+1 && name===game[game.clockTurn]) {
            game.used[game.clockTurn]+=Math.max(0,now()-game.clockAt);
            if(game.used[game.clockTurn]>=game.limitMs) finishGame(game,game.clockTurn==='red'?'black':'red');
            else {game.moved[game.clockTurn]=true;db.prepare(`UPDATE game_history SET ${game.clockTurn}_moved=1 WHERE id=?`).run(game.id);game.clockPly=data.ply;game.clockTurn=game.clockTurn==='red'?'black':'red';game.clockAt=now();armClock(game);}
          } else if(data.ply>game.clockPly) throw fail(409,'计时步数不一致');
        }
        if(path==='/clock/move' && data.content?.record?.moves?.length===game.clockPly) {
          saveGameRecord(game,data.content);game.snapshot=data.content;game.selected=null;publishWatch(game);
        }
        json(res,200,clockState(game));return;
      }
      if(path==='/resign') {
        try{saveGameRecord(game,data.content);}catch{}
        finishGame(game,name===game.red?'black':'red');json(res,200,{ok:true});return;
      }
      if(path==='/draw/offer') {
        if(game.result || game.drawOffer) throw fail(409,'已有提和或本局已结束');
        if(!send(peer,{type:'draw-offer',gameId:game.id})) throw fail(409,'对方离线');
        game.drawOffer=name;json(res,200,{ok:true});return;
      }
      if(path==='/draw/respond') {
        if(game.result || game.drawOffer!==peer || typeof data.accept!=='boolean') throw fail(400,'提和已失效');
        game.drawOffer=null;
        if(data.accept){try{saveGameRecord(game,data.content);}catch{} finishGame(game,'draw');}
        else send(peer,{type:'draw-declined',gameId:game.id});
        json(res,200,{ok:true});return;
      }
      if(path==='/watch/selection') {
        if(game.result || name!==game[game.clockTurn] || data.ply!==game.clockPly) throw fail(409,'当前不能摸子');
        const point=data.point;
        if(point!==null && !(Array.isArray(point) && point.length===2 && Number.isInteger(point[0]) && Number.isInteger(point[1]) && point[0]>=0 && point[0]<9 && point[1]>=0 && point[1]<10)) throw fail(400,'摸子坐标错误');
        game.selected=point;publishWatch(game);json(res,200,{ok:true});return;
      }
      if(path==='/watch/update') {
        if(data.content?.record?.moves?.length!==game.clockPly) {json(res,200,{ok:true});return;}
        if(game.snapshot && data.content?.record?.moves?.length<game.snapshot.record.moves.length) {json(res,200,{ok:true});return;}
        saveGameRecord(game,data.content);
        game.snapshot=data.content;
        publishWatch(game);
        json(res,200,{ok:true});return;
      }
      if (path === '/next-game') {
        saveGameRecord(game,data.content);
        if (!['red','black','draw'].includes(data.result)) throw fail(400,'对局结果错误');
        game.finished ??= new Map(); game.finished.set(name,data.result);
        if (game.finished.size===2 && new Set(game.finished.values()).size!==1) throw fail(409,'双方结果不一致，请核对局面');
        if (game.finished.size===2) finishGame(game,data.result);
        json(res,200,{ok:true}); return;
      }
      if (path === '/signal') {
        if (!['offer', 'answer', 'candidate', 'restart'].includes(data.kind)) throw fail(400, '信令类型错误');
        if (data.kind !== 'restart' && (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload))) throw fail(400, '信令内容错误');
        if (!send(peer, { type: 'signal', gameId: game.id, from: name, kind: data.kind, payload: data.payload })) throw fail(409, '对手已离线');
        json(res, 200, { ok: true }); return;
      }
      if (path === '/leave') {
        // Ending a match must never be blocked by a record upload failure.
        try { saveGameRecord(game,data.content); } catch {}
        closeGame(game,name);
        json(res, 200, { ok: true,stats:matchup(name,peer) }); return;
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
  server.on('close', () => { closed=true; clearInterval(maintenance);for(const timer of offlineTimers.values())clearTimeout(timer); for (const game of games.values()) {clearTimeout(game.nextTimer);clearTimeout(game.clockTimer);} db.close(); });
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
