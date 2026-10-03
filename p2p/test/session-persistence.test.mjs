import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSignalingServer} from '../server.mjs';

test('登录跨服务重启保留，活跃续期，退出后跨重启仍失效',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'yisi-session-'));
  let time=Date.now(),server,base;
  const start=async()=>{server=createSignalingServer({database:join(directory,'test.sqlite'),now:()=>time});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;};
  const stop=()=>new Promise(r=>server.close(r));
  const post=async(path,data,token='')=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});return {status:response.status,...await response.json()};};
  try{
    await start();const account=await post('/register',{name:'保持登录',password:'1'});await stop();
    time+=20*24*60*60_000;await start();assert.equal((await post('/ice',{},account.token)).status,200);
    await stop();time+=20*24*60*60_000;await start();assert.equal((await post('/ice',{},account.token)).status,200,'活跃使用后续期');
    assert.equal((await post('/logout',{},account.token)).status,200);await stop();await start();
    assert.equal((await post('/ice',{},account.token)).status,401,'主动退出永久撤销旧凭证');
    const fresh=await post('/login',{name:'保持登录',password:'1'});await stop();time+=31*24*60*60_000;await start();
    assert.equal((await post('/ice',{},fresh.token)).status,401,'长期不使用最终过期');
  }finally{if(server.listening)await stop();await rm(directory,{recursive:true,force:true});}
});
