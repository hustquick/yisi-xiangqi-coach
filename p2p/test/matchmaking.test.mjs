import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSignalingServer} from '../server.mjs';

test('匹配同局时、去重、取消、掉线清理及与邀请互斥',async()=>{
  const server=createSignalingServer({database:':memory:'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,streams=[];
  const post=async(path,data,token='')=>{
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
    return {status:response.status,...await response.json()};
  };
  const connect=async user=>{
    const controller=new AbortController();streams.push(controller);let events='';
    const response=await fetch(base+'/events',{headers:{Authorization:`Bearer ${user.token}`},signal:controller.signal});
    void response.body.pipeTo(new WritableStream({write(chunk){events+=new TextDecoder().decode(chunk);}})).catch(()=>{});
    return {controller,events:()=>events};
  };
  try {
    const a=await post('/register',{name:'matchA',password:'1'}),b=await post('/register',{name:'matchB',password:'1'}),c=await post('/register',{name:'matchC',password:'1'});
    assert.equal((await post('/match/join',{},a.token)).status,409,'离线不能进入队列');
    const sa=await connect(a),sb=await connect(b);await connect(c);
    assert.equal((await post('/match/join',{minutes:60},a.token)).status,400);
    assert.equal((await post('/match/join',{minutes:10},a.token)).waiting,true);
    assert.equal((await post('/match/join',{minutes:10},a.token)).waiting,true);
    assert.equal((await post('/invite',{to:a.name},c.token)).status,409);
    assert.equal((await post('/match/join',{minutes:15},b.token)).waiting,true,'不同局时不匹配');
    const paired=await post('/match/join',{minutes:10},c.token);
    assert.equal(paired.waiting,false);assert.ok(paired.gameId);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.match(sa.events(),/"type":"game"/);assert.doesNotMatch(sb.events(),/"type":"game"/);
    assert.equal((await post('/clock',{gameId:paired.gameId},a.token)).limit,600000);
    assert.equal((await post('/match/join',{minutes:10},a.token)).status,409,'在局中不能重复匹配');
    await post('/leave',{gameId:paired.gameId},a.token);
    assert.equal((await post('/match/leave',{},b.token)).waiting,false);
    assert.equal((await post('/match/join',{minutes:15},c.token)).waiting,true,'取消的玩家不能被匹配');
    await post('/match/leave',{},c.token);
    await post('/match/join',{minutes:5},a.token);
    sa.controller.abort();await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal((await post('/match/join',{minutes:5},b.token)).waiting,true,'掉线移除队列');
    await post('/match/leave',{},b.token);
    assert.equal((await post('/history',{},a.token)).games.length,0,'无人行棋不产生历史');
  }finally{streams.forEach(s=>s.abort());server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
