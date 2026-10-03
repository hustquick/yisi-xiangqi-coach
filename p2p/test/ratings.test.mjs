import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {eloDelta,createRatings,nearestOpponent} from '../ratings.mjs';
test('Elo 结果、强弱对手和近分优先',()=>{
  assert.equal(eloDelta(1200,1200,'red'),16);
  assert.equal(eloDelta(1200,1200,'black'),-16);
  assert.equal(eloDelta(1200,1200,'draw'),0);
  assert.ok(eloDelta(1200,1600,'red')>16);
  const entries=[['far',{minutes:15,joined:0}],['near',{minutes:15,joined:10}],['other',{minutes:10,joined:0}]];
  const scores={self:1200,far:1600,near:1220,other:1200};
  assert.equal(nearestOpponent(entries,'self',15,n=>scores[n],100,n=>true),'near');
  assert.equal(nearestOpponent(entries.slice(0,1),'self',15,n=>scores[n],100,n=>true),undefined);
  assert.equal(nearestOpponent(entries.slice(0,1),'self',15,n=>scores[n],180000,n=>true),'far');
});
test('历史回算、重复结算和无效局隔离',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE game_history(id TEXT PRIMARY KEY,red TEXT,black TEXT,started INTEGER,ended INTEGER,result TEXT,red_moved INTEGER,black_moved INTEGER)');
  db.exec("INSERT INTO game_history VALUES('1','a','b',1,2,'red',1,1),('2','a','b',2,3,'black',1,0),('3','a','b',3,4,'服务中断',1,1)");
  const r=createRatings(db);assert.deepEqual({...r.get('a')},{rating:1216,games:1});assert.equal(r.get('b').rating,1184);
  r.sync();assert.equal(r.get('a').rating,1216);
  assert.equal(createRatings(db).get('a').games,1);
  db.close();
});
