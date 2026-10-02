type Side = 'red' | 'black';
type Piece = { id: string; side: Side; name: string; x: number; y: number };
type Point = [number, number];

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
