import assert from 'node:assert/strict';
const base='https://141.148.168.171', controllers=[];
const post=async(path,data,token='')=>{
  const response=await fetch(base+'/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
  assert.equal(response.status,200,await response.clone().text());return response.json();
};
let a,b,id;
try {
  const stamp=Date.now();
  a=await post('register',{name:`Step${stamp}A`,password:'1'});
  b=await post('register',{name:`Step${stamp}B`,password:'1'});
  for(const player of [a,b]) {
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(base+'/events',{headers:{Authorization:`Bearer ${player.token}`},signal:controller.signal});
    void response.body.pipeTo(new WritableStream({write(){}})).catch(()=>{});
  }
  const invite=await post('invite',{to:b.name,side:'red',minutes:15},a.token);
  id=(await post('respond',{id:invite.id,accept:true},b.token)).gameId;
  await post('clock/move',{gameId:id,ply:1},a.token);
  await post('clock/move',{gameId:id,ply:2},b.token);
  const first=await post('clock',{gameId:id},a.token);
  assert.equal(first.stepLimit,30000);
  await new Promise(resolve=>setTimeout(resolve,2200));
  const second=await post('clock',{gameId:id},a.token);
  assert.ok(first.stepRemaining-second.stepRemaining>=1800);
  console.log('PASS deployed countdown decreases',first.stepRemaining,second.stepRemaining);
  await new Promise(resolve=>setTimeout(resolve,second.stepRemaining+150));
  const ended=await post('clock',{gameId:id},a.token);
  assert.equal(ended.ended,true);assert.equal(ended.stepRemaining,0);
  const history=await post('history',{},a.token);
  assert.equal(history.games.find(game=>game.id===id).result,'black');
  console.log('PASS deployed real 30-second timeout adjudicates black win');
} finally {
  if(id&&a)await post('leave',{gameId:id},a.token).catch(()=>{});
  for(const player of [a,b])if(player)await post('logout',{},player.token).catch(()=>{});
  controllers.forEach(controller=>controller.abort());
}
