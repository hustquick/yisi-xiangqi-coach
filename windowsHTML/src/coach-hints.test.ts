import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachHints, coachPlan, xiangqiPieceLabel } from './coach-hints.ts';

test('有保护的马被炮攻击不自动列为战术警报', () => {
  const pieces = [{ id: 'r', name: '马', side: 'red' as const, x: 7, y: 9 }, { id: 'c', name: '炮', side: 'black' as const, x: 1, y: 2 }, { id: 'd', name: '车', side: 'red' as const, x: 8, y: 9 }];
  const plan = coachPlan(pieces, 'red', (p, x, y) => x === 7 && y === 9 && (p.id === 'c' || p.id === 'd'), () => false, [], uci => uci);
  assert.ok(!plan.some(p => p.title === '战术警报'));
});

test('比较同深度候选，按合法主变化列出双方应对', () => {
  const pieces = [{ id: 'r', name: '车', side: 'red' as const, x: 0, y: 9 }, { id: 'b', name: '车', side: 'black' as const, x: 8, y: 0 }];
  const lines = [
    { depth: 12, multipv: 1, score: 'cp 120', pv: 'a0a1 i9i8' },
    { depth: 12, multipv: 2, score: 'cp 40', pv: 'a0b0' },
    { depth: 8, multipv: 3, score: 'cp -500', pv: 'a0c0' },
  ];
  const plan = coachPlan(pieces, 'red', () => true, () => false, lines, uci => uci);
  assert.ok(plan.find(p => p.title === '建议走法与计算线')?.text.includes('你：a0a1 → 对手：i9i8'));
  const comparisons = plan.find(p => p.title === '备选与代价')?.text;
  assert.ok(comparisons?.includes('0.80'));
  assert.ok(!comparisons?.includes('a0c0'));
});
test('遇到非法主变化立即停止，不编造后续吃子', () => {
  const pieces = [{ id: 'r', name: '车', side: 'red' as const, x: 0, y: 9 }];
  const plan = coachPlan(pieces, 'red', () => false, () => false, [{ depth: 8, multipv: 1, score: 'cp 0', pv: 'a0a1' }], uci => uci);
  assert.ok(!plan.some(p => p.title === '建议走法与计算线'));
});

test('使用红方中文路数、黑方数字路数，同路棋子区分前后', () => {
  const pieces = [
    { id: 'm', name: '马', side: 'black' as const, x: 7, y: 0 },
    { id: 'p', name: '卒', side: 'black' as const, x: 4, y: 3 },
    { id: 'r1', name: '车', side: 'red' as const, x: 0, y: 7 },
    { id: 'r2', name: '车', side: 'red' as const, x: 0, y: 9 },
  ];
  assert.equal(xiangqiPieceLabel(pieces[0], pieces), '黑马8');
  assert.equal(xiangqiPieceLabel(pieces[1], pieces), '黑卒5');
  assert.equal(xiangqiPieceLabel(pieces[2], pieces), '红前车（九路）');
  assert.equal(xiangqiPieceLabel(pieces[3], pieces), '红后车（九路）');
});

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
