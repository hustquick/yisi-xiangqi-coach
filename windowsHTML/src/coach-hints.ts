type Side = 'red' | 'black';
type Piece = { id: string; side: Side; name: string; x: number; y: number };
type Point = [number, number];
type Line = { depth: number; multipv: number; score: string; pv: string };
const material: Record<string, number> = { 车: 9, 炮: 4.5, 马: 4, 相: 2, 象: 2, 仕: 2, 士: 2, 兵: 1, 卒: 1 };

export function coachPlan(pieces: Piece[], side: Side, legal: (piece: Piece, x: number, y: number, board: Piece[]) => boolean, check: (side: Side, board: Piece[]) => boolean, lines: Line[], notation: (uci: string, board: Piece[]) => string) {
  const other = side === 'red' ? 'black' : 'red';
  const tips: Array<{ title: string; text: string }> = [];
  const threats = pieces.filter(p => p.side === side && material[p.name]).flatMap(target => {
    const attackers = pieces.filter(p => p.side === other && legal(p, target.x, target.y, pieces));
    return attackers.length ? [{ target, attacker: attackers.sort((a, b) => (material[a.name] ?? 100) - (material[b.name] ?? 100))[0] }] : [];
  }).sort((a, b) => material[b.target.name] - material[a.target.name]);
  if (check(side, pieces)) tips.push({ title: '第一任务：解将', text: '当前将帅受攻击。下列候选均需先满足解将；不能用普通进攻代替应将。' });
  else for (const { target, attacker } of threats) {
    const afterCapture = pieces.filter(p => p.id !== target.id).map(p => p.id === attacker.id ? { ...p, x: target.x, y: target.y } : p);
    const defenders = afterCapture.filter(p => p.side === side && legal(p, target.x, target.y, afterCapture));
    // A defended equal-or-costlier exchange is not automatically an urgent threat.
    if (defenders.length && (material[attacker.name] ?? 100) >= material[target.name] && !check(side, afterCapture)) continue;
    tips.push({ title: '战术警报', text: `${xiangqiPieceLabel(target, pieces)}受${xiangqiPieceLabel(attacker, pieces)}攻击：${defenders.length ? `${xiangqiPieceLabel(defenders[0], afterCapture)}虽能吃回，但对方可用较低价值子交换。` : '被吃后暂无立即吃回手段。'}结合候选变化判断是否需要先处理。` });
    break;
  }
  const sorted = [...lines].sort((a, b) => a.multipv - b.multipv);
  const best = sorted[0];
  if (!best) return tips;
  const mate = best.score.match(/mate\s+(-?\d+)/), cp = best.score.match(/cp\s+(-?\d+)/);
  tips.push({ title: '局面判断', text: mate ? `${Number(mate[1]) > 0 ? '有杀棋' : '需防杀棋'} · 搜索距离 ${Math.abs(Number(mate[1]))} · 深度 ${best.depth}` : cp ? `${side === 'red' ? '红方' : '黑方'}视角 ${Number(cp[1]) >= 0 ? '+' : ''}${(Number(cp[1]) / 100).toFixed(2)} · 深度 ${best.depth}${best.depth <= 8 ? ' · 初步分析，建议加深核对' : ''}` : `深度 ${best.depth} · 暂无评分` });
  let board = pieces.map(p => ({ ...p })), mover = side, gain = 0;
  const sequence: string[] = [], actions: string[] = [];
  let purpose = '';
  for (const uci of best.pv.trim().split(/\s+/).slice(0, 4)) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) break;
    const x = uci.charCodeAt(0) - 97, y = 9 - Number(uci[1]), tx = uci.charCodeAt(2) - 97, ty = 9 - Number(uci[3]);
    const moving = board.find(p => p.x === x && p.y === y);
    if (!moving || moving.side !== mover || !legal(moving, tx, ty, board)) break;
    const captured = board.find(p => p.x === tx && p.y === ty);
    const name = notation(uci, board);
    if (!sequence.length && !captured) {
      if (moving.name === '马' && moving.y === (side === 'red' ? 9 : 0)) purpose = '出动底线马，完成大子展开。';
      else if (moving.name === '炮' && tx === 4 && x !== 4) purpose = '炮转中路，形成中炮配置。';
      else if (moving.name === '车' && tx !== x) purpose = '横移车，调整占线。';
      else if (['兵', '卒'].includes(moving.name) && ty !== y) purpose = `${(side === 'red' ? ty <= 4 : ty >= 5) && !(side === 'red' ? y <= 4 : y >= 5) ? '兵卒过河，增加横向活动能力。' : '挺兵卒，推进这一线路。'}`;
    }
    sequence.push(`${mover === side ? '你' : '对手'}：${name}`);
    if (captured) { gain += (mover === side ? 1 : -1) * (material[captured.name] ?? 0); actions.push(`${name}吃${xiangqiPieceLabel(captured, board)}`); }
    board = board.filter(p => p.id !== captured?.id).map(p => p.id === moving.id ? { ...p, x: tx, y: ty } : p);
    if (check(mover === 'red' ? 'black' : 'red', board)) actions.push(`${name}将军`);
    mover = mover === 'red' ? 'black' : 'red';
  }
  if (sequence.length) tips.push({ title: '建议走法与计算线', text: `${purpose}${sequence.join(' → ')}。${actions.length ? `${actions.join('；')}。局部交换${gain ? `净值 ${gain > 0 ? '+' : ''}${gain.toFixed(1)}` : '持平'}（粗略子力，变化可能未结束）。` : ''}` });
  const alternatives = sorted.slice(1, 3).filter(line => line.depth === best.depth);
  if (cp && alternatives.length) {
    const comparisons = alternatives.flatMap(line => {
      const value = line.score.match(/cp\s+(-?\d+)/); if (!value) return [];
      const loss = (Number(cp[1]) - Number(value[1])) / 100;
      return [`${notation(line.pv.split(/\s+/)[0], pieces)}：${loss <= 0.1 ? '本次评分接近' : `相差 ${loss.toFixed(2)}`}`];
    });
    if (comparisons.length) tips.push({ title: '备选与代价', text: comparisons.join('；') + '。' });
  }
  return tips;
}

export function xiangqiPieceLabel(piece: Piece, pieces: Piece[]) {
  const road = piece.side === 'red' ? ['九', '八', '七', '六', '五', '四', '三', '二', '一'][piece.x] : String(piece.x + 1);
  const sameRoad = pieces.filter(p => p.side === piece.side && p.name === piece.name && p.x === piece.x)
    .sort((a, b) => piece.side === 'red' ? a.y - b.y : b.y - a.y);
  const index = sameRoad.findIndex(p => p.id === piece.id);
  const prefix = piece.side === 'red' ? '红' : '黑';
  if (sameRoad.length <= 1) return `${prefix}${piece.name}${road}`;
  const order = index === 0 ? '前' : index === sameRoad.length - 1 ? '后' : sameRoad.length === 3 ? '中' : `从前数第${index + 1}枚`;
  return `${prefix}${order}${piece.name}（${road}路）`;
}

// Tactical facts, not a substitute for engine evaluation or a forced-win claim.
export function coachHints(pieces: Piece[], side: Side, legal: (piece: Piece, x: number, y: number, board: Piece[]) => boolean, check: (side: Side, board: Piece[]) => boolean, best?: { from?: Point; to?: Point; move: string; reply?: string }) {
  const other = side === 'red' ? 'black' : 'red';
  const label = (p: Piece) => xiangqiPieceLabel(p, pieces);
  const tips: string[] = [];
  if (check(side, pieces)) tips.push('当前被将军：先解将，再考虑进攻；可比较移帅、吃掉将军子和垫子三类应对。');
  const exposed = pieces.filter(p => p.side === side && !['帅', '将'].includes(p.name) && pieces.some(attacker => attacker.side === other && legal(attacker, p.x, p.y, pieces)));
  if (exposed.length) tips.push(`直接受攻击：${exposed.slice(0, 3).map(label).join('、')}。先核对能否吃回或反击；受攻击不等于必然丢子。`);
  if (!best?.from || !best.to) return tips;
  const piece = pieces.find(p => p.x === best.from![0] && p.y === best.from![1]);
  if (!piece || piece.side !== side || !legal(piece, best.to[0], best.to[1], pieces)) return tips;
  const captured = pieces.find(p => p.x === best.to![0] && p.y === best.to![1]);
  const next = pieces.filter(p => p.id !== captured?.id).map(p => p.id === piece.id ? { ...p, x: best.to![0], y: best.to![1] } : p);
  const facts: string[] = [];
  if (captured) facts.push(`吃掉${label(captured)}，但需继续检查对手能否吃回`);
  if (check(other, next)) facts.push('形成将军，迫使对方先应将');
  if (exposed.some(p => p.id === piece.id) && !next.some(p => p.side === other && legal(p, best.to![0], best.to![1], next))) facts.push('把受攻击的棋子移到当前不受直接攻击的位置');
  if (facts.length) tips.push(`候选 ${best.move}：${facts.join('；')}。`);
  else tips.push(`优先计算 ${best.move}；本步没有直接吃子或将军，不能只凭表面威胁判断优劣。`);
  if (best.reply) tips.push(`引擎主变化中的对手回应：${best.reply}。先在棋盘演示，再检查下一步是否仍能执行你的计划；这是当前搜索结果，不是唯一应手。`);
  return tips.slice(0, 4);
}
