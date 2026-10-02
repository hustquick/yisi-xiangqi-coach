import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSignalingServer } from '../server.mjs';

test('好友观战权限、提和、认输及棋谱失败仍能退出', async()=>{
  let clock=1000;
  const server=createSignalingServer({database:':memory:',now:()=>clock});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
  const request=async(path,data,token='')=>{
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
    return {status:response.status,...await response.json()};
  };
  try{
    const a=await request('/register',{name:'playerA',password:'1'}),b=await request('/register',{name:'playerB',password:'1'}),w=await request('/register',{name:'watcher',password:'1'});
    for(const user of [a,b,w]){const controller=new AbortController();controllers.push(controller);const response=await fetch(base+'/events',{headers:{Authorization:`Bearer ${user.token}`},signal:controller.signal});void response.body.pipeTo(new WritableStream({write(){}})).catch(()=>{});}
    const invite=await request('/invite',{to:b.name},a.token);
    const game=await request('/respond',{id:invite.id,accept:true},b.token);
    clock+=2000;
    const firstClock=await request('/clock',{gameId:game.gameId},a.token);
    assert.equal(firstClock.limit,600000);assert.equal(firstClock.used.red,2000);assert.equal(firstClock.used.black,0);
    assert.equal((await request('/clock/move',{gameId:game.gameId,ply:1},b.token)).status,409);
    await request('/clock/move',{gameId:game.gameId,ply:1},a.token);
    clock+=3000;
    const secondClock=await request('/clock',{gameId:game.gameId},b.token);
    assert.equal(secondClock.used.red,2000);assert.equal(secondClock.used.black,3000);
    await request('/time/offer',{gameId:game.gameId},a.token);
    assert.equal((await request('/time/respond',{gameId:game.gameId,accept:true},a.token)).status,400);
    await request('/time/respond',{gameId:game.gameId,accept:false},b.token);
    assert.equal((await request('/clock',{gameId:game.gameId},a.token)).limit,600000);
    await request('/time/offer',{gameId:game.gameId},a.token);await request('/time/respond',{gameId:game.gameId,accept:true},b.token);
    assert.equal((await request('/clock',{gameId:game.gameId},a.token)).limit,900000);
    const undoContent={version:1,record:{title:'悔棋测试',pieces:[],turn:'red',moves:[{from:[0,6],to:[0,5]}]}};
    await request('/undo/offer',{gameId:game.gameId,content:undoContent},a.token);
    assert.equal((await request('/undo/respond',{gameId:game.gameId,accept:true},a.token)).status,400);
    await request('/undo/respond',{gameId:game.gameId,accept:true},b.token);
    assert.equal((await request('/clock',{gameId:game.gameId},a.token)).turn,'red');
    assert.equal((await request('/watch',{name:a.name},w.token)).status,403);
    await request('/friends/add',{name:a.name},w.token);await request('/friends/respond',{name:w.name,accept:true},a.token);
    const content={version:1,record:{title:'观战测试',pieces:[],turn:'red',moves:[]},activePly:0};
    assert.equal((await request('/watch/update',{gameId:game.gameId,content},a.token)).status,200);
    assert.deepEqual((await request('/watch',{name:a.name},w.token)).content,content);
    assert.equal((await request('/resign',{gameId:game.gameId},w.token)).status,403);
    await request('/draw/offer',{gameId:game.gameId},a.token);
    assert.equal((await request('/draw/respond',{gameId:game.gameId,accept:true},a.token)).status,400);
    await request('/draw/respond',{gameId:game.gameId,accept:false},b.token);
    await request('/draw/offer',{gameId:game.gameId},a.token);
    clock+=100;await request('/draw/respond',{gameId:game.gameId,accept:true,content},b.token);
    assert.equal((await request('/history',{},a.token)).games[0].result,'draw');
    await new Promise(resolve=>setTimeout(resolve,5200));
    const next=(await request('/history',{},a.token)).games[0];
    assert.equal((await request('/clock',{gameId:next.id},a.token)).limit,600000,'下一局不继承临时加时');
    clock+=100;await request('/resign',{gameId:next.id,content},a.token);
    assert.equal((await request('/history',{},a.token)).games[0].result,'red');
    assert.equal((await request('/leave',{gameId:next.id,content:{invalid:true}},a.token)).status,200);
    assert.equal((await request('/search',{name:b.id},w.token)).user.busy,false);
    assert.equal((await request('/watch',{name:a.name},w.token)).status,404);
  }finally{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('非好友邀请、云端用时记录和自动交换先后手', async () => {
  let clock=100000;
  const server=createSignalingServer({database:':memory:',now:()=>clock});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const controllers=[];
  const post=async(path,data,token='')=>{
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
    assert.equal(response.status,200);return response.json();
  };
  try {
    const a=await post('/register',{name:'roundA',password:'1'}),b=await post('/register',{name:'roundB',password:'1'});
    for(const user of [a,b]) {
      const controller=new AbortController();controllers.push(controller);
      const response=await fetch(base+'/events',{headers:{Authorization:`Bearer ${user.token}`},signal:controller.signal});
      void response.body.pipeTo(new WritableStream({write(){}})).catch(()=>{});
    }
    const invite=await post('/invite',{to:b.name},a.token);
    const game=await post('/respond',{id:invite.id,accept:true},b.token);
    clock+=12345;
    const content={version:1,record:{title:'测试对局',pieces:[],turn:'red',moves:[]},activePly:0};
    await post('/next-game',{gameId:game.gameId,result:'red',content},a.token);
    await post('/next-game',{gameId:game.gameId,result:'red'},b.token);
    const history=await post('/history',{},a.token);
    assert.equal(history.games[0].duration,12345);
    assert.equal(history.games[0].result,'red');
    assert.equal(history.games[0].opponent.id,b.id);
    assert.deepEqual((await post('/history/get',{id:game.gameId},b.token)).content,content);
    await new Promise(resolve=>setTimeout(resolve,5200));
    const next=(await post('/history',{},a.token)).games;
    assert.equal(next.length,2);
    assert.equal(next[0].side,'black');
    const left=await post('/leave',{gameId:next[0].id},a.token);
    assert.equal(left.stats.total,1);assert.equal(left.stats.wins,1);assert.equal(left.stats.losses,0);
    assert.equal((await post('/history',{opponentId:b.id},a.token)).games.length,2);
    assert.equal((await post('/history',{opponentId:b.id},a.token)).games.find(row=>row.id===game.gameId).hasRecord,true);
    assert.equal((await post('/history',{},b.token)).games[0].result,'black-left');
    clock+=1;
    const keepInvite=await post('/invite',{to:b.name,side:'black',swapSides:false},a.token);
    const keepGame=await post('/respond',{id:keepInvite.id,accept:true},b.token);
    assert.equal((await post('/history',{},a.token)).games[0].side,'black');
    clock+=100;
    await post('/next-game',{gameId:keepGame.gameId,result:'black'},a.token);
    await post('/next-game',{gameId:keepGame.gameId,result:'black'},b.token);
    await new Promise(resolve=>setTimeout(resolve,5200));
    assert.equal((await post('/history',{},a.token)).games[0].side,'black','保持执棋方时不换边');
    const c=await post('/register',{name:'roundC',password:'1'});
    assert.equal((await post('/history',{},c.token)).games.length,0);
    const chinese=await post('/register',{name:'弈思棋友张三',password:'1'});
    assert.equal(chinese.name,'弈思棋友张三');
    const chineseLogin=await post('/login',{name:'弈思棋友张三',password:'1'});
    assert.equal(chineseLogin.id,chinese.id);
    const duplicate=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'弈思棋友张三',password:'1'})});
    assert.equal(duplicate.status,409);
    assert.match((await duplicate.json()).error,/账号已存在/);
    assert.equal((await post('/search',{name:'棋友'},a.token)).users[0].id,chinese.id);
    const timedGame=(await post('/history',{},a.token)).games[0];
    clock+=600001;
    assert.equal((await post('/clock',{gameId:timedGame.id},a.token)).ended,true);
    assert.equal((await post('/history',{},a.token)).games[0].result,'black','红方用时耗尽由服务器判负');
    await post('/leave',{gameId:timedGame.id},a.token);
  } finally {
    controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});

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
    assert.notEqual(a.body.id,b.body.id);
    assert.equal(a.body.id,'000000001');
    assert.equal(b.body.id,'000000002');
    assert.match(String(a.body.id),/^\d{9}$/);
    assert.match(String(b.body.id),/^\d{9}$/);
    assert.equal((await post('/profile',{nickname:'测试名称'},b.body.token)).status,200);
    assert.equal((await post('/search',{name:String(b.body.id)},a.body.token)).body.user.nickname,'测试名称');
    assert.equal((await post('/search',{name:'试名'},a.body.token)).body.users[0].id,b.body.id);
    assert.equal((await post('/search',{name:'2'},a.body.token)).body.user.id,b.body.id);
    assert.deepEqual((await post('/history',{},a.body.token)).body.games,[]);
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
    assert.equal((await post('/friends/add', { name: 'B' }, a.body.token)).body.friends.length,0,'未同意不得加入好友');
    assert.equal((await post('/friends', {}, b.body.token)).body.friends.length, 0, '每个账号独立保存好友');
    assert.equal((await post('/friends/respond',{name:'a',accept:true},b.body.token)).body.friends[0].name,'a');
    assert.equal((await post('/friends',{},a.body.token)).body.friends[0].name,'b');
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
