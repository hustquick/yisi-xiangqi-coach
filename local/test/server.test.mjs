import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalWebServer} from '../start-local.mjs';

test('本地入口接入云端账号，计算引擎仍从本机加载，不暴露源码目录',async()=>{
  const server=createLocalWebServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const html=await (await fetch(base)).text();
    assert.match(html,/name="yisi-network-endpoint" content="https:\/\/141\.148\.168\.171"/);
    assert.match(html,/src="\.\/engine-data\.js"/);
    assert.doesNotMatch(html,/src="https:.*engine-data/);
    const engine=await fetch(base+'/engine-data.js',{method:'HEAD'});
    assert.equal(engine.status,200);assert.ok(Number(engine.headers.get('content-length'))>1000000);
    for(const path of ['/start-local.mjs','/src/App.tsx','/.env','/%2e%2e%2fp2p/server.mjs']) assert.equal((await fetch(base+path)).status,404);
    assert.equal((await fetch(base,{method:'POST'})).status,405);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
