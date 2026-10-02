import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachHints } from './coach-hints.ts';

test('提示将军、受攻击与具体候选，不声称必然丢子', () => {
  const pieces = [{ id: 'r', name: '车', side: 'red' as const, x: 0, y: 9 }, { id: 'b', name: '马', side: 'black' as const, x: 0, y: 7 }];
  const hints = coachHints(pieces, 'red', () => true, () => true, { from: [0, 9], to: [0, 7], move: '车九进二', reply: '将五平四' });
  assert.ok(hints.some(h => h.includes('先解将')));
  assert.ok(hints.some(h => h.includes('不等于必然丢子')));
  assert.ok(hints.some(h => h.includes('吃掉黑马') && h.includes('形成将军')));
  assert.ok(hints.some(h => h.includes('将五平四') && h.includes('不是唯一应手')));
});
test('无引擎候选时只提示可核验威胁；不解释非法候选', () => {
  const pieces = [{ id: 'r', name: '车', side: 'red' as const, x: 0, y: 9 }];
  assert.deepEqual(coachHints(pieces, 'red', () => false, () => false), []);
  assert.deepEqual(coachHints(pieces, 'red', () => false, () => false, { from: [0, 9], to: [1, 7], move: '非法' }), []);
});
