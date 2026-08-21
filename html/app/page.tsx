"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";

function Collapsible({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);
  return <details className="collapsible-module" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary>{title}</summary><div className="collapsible-content">{children}</div></details>;
}
import { parseFen, parseXqf, SAVED_GAME_VERSION } from "./game-record";

type Side = "red" | "black";
type GameMode = "local" | "computer" | "setup";
type SetupBrush = "move" | "erase" | { side: Side; name: string };
type Piece = { id: string; side: Side; name: string; x: number; y: number };
type Move = {
  piece: Piece;
  from: [number, number];
  to: [number, number];
  captured?: Piece;
  beforeScore?: number;
  wasEngineBest?: boolean;
  bestBefore?: string;
};
type Candidate = {
  move: string;
  score: string;
  tag: string;
  tone: string;
  pv?: string;
  uciMoves: string[];
  from?: [number, number];
  to?: [number, number];
};
type EngineLine = {
  depth: number;
  multipv: number;
  score: string;
  pv: string;
  error?: string;
};
type EvaluationPoint = { ply: number; score: number | null };
type GameOutcome = { title: string; detail: string };
type VariationFrame = {
  pieces: Piece[];
  movingPiece?: Piece;
  capturedPiece?: Piece;
  notation: string;
  step: string;
  from?: [number, number];
  to?: [number, number];
};
type VariationPreview = {
  title: string;
  frames: VariationFrame[];
  index: number;
};
const DEPTH_OPTIONS = [8, 10, 12, 14, 16] as const;

const initialPieces: Piece[] = [
  ...["车", "马", "相", "仕", "帅", "仕", "相", "马", "车"].map((name, x) => ({
    id: `r${x}`,
    side: "red" as const,
    name,
    x,
    y: 9,
  })),
  { id: "rp1", side: "red", name: "炮", x: 1, y: 7 },
  { id: "rp2", side: "red", name: "炮", x: 7, y: 7 },
  ...[0, 2, 4, 6, 8].map((x, i) => ({
    id: `rb${i}`,
    side: "red" as const,
    name: "兵",
    x,
    y: 6,
  })),
  ...["车", "马", "象", "士", "将", "士", "象", "马", "车"].map((name, x) => ({
    id: `b${x}`,
    side: "black" as const,
    name,
    x,
    y: 0,
  })),
  { id: "bp1", side: "black", name: "炮", x: 1, y: 2 },
  { id: "bp2", side: "black", name: "炮", x: 7, y: 2 },
  ...[0, 2, 4, 6, 8].map((x, i) => ({
    id: `bz${i}`,
    side: "black" as const,
    name: "卒",
    x,
    y: 3,
  })),
];

const files = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];
const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const setupPieces: Record<Side, string[]> = {
  red: ["车", "马", "相", "仕", "帅", "炮", "兵"],
  black: ["车", "马", "象", "士", "将", "炮", "卒"],
};

function moveName(move: Move) {
  const forward =
    move.piece.side === "red"
      ? move.to[1] < move.from[1]
      : move.to[1] > move.from[1];
  const diagonalPiece = ["马", "相", "象", "仕", "士"].includes(
    move.piece.name,
  );
  const action = diagonalPiece
    ? forward
      ? "进"
      : "退"
    : move.to[0] === move.from[0]
      ? forward
        ? "进"
        : "退"
      : "平";
  const start =
    move.piece.side === "red" ? files[move.from[0]] : String(move.from[0] + 1);
  const end =
    move.piece.side === "red" ? files[move.to[0]] : String(move.to[0] + 1);
  const amount = Math.abs(move.to[1] - move.from[1]);
  const amountText =
    move.piece.side === "red" ? numerals[amount] : String(amount);
  return `${move.piece.name}${start}${action}${action === "平" || diagonalPiece ? end : amountText}`;
}

function engineCp(line?: EngineLine) {
  const match = line?.score.match(/cp\s+(-?\d+)/);
  return match ? Number(match[1]) : null;
}

function redPerspectiveValue(value: number, sideToMove: Side) {
  return sideToMove === "red" ? value : -value;
}

function sideAfterPly(startingTurn: Side, ply: number): Side {
  return ply % 2 === 0
    ? startingTurn
    : startingTurn === "red" ? "black" : "red";
}

function redPerspectiveScore(
  line: EngineLine | undefined,
  sideToMove: Side,
  fallback = "暂无评分",
) {
  if (!line) return fallback;
  const scoreMatch = line.score.match(/(cp|mate)\s+(-?\d+)/);
  if (!scoreMatch) return fallback;
  const value = redPerspectiveValue(Number(scoreMatch[2]), sideToMove);
  if (scoreMatch[1] === "mate")
    return `${value >= 0 ? "红方" : "黑方"}杀${Math.abs(value)}`;
  return `${value >= 0 ? "+" : ""}${(value / 100).toFixed(2)}`;
}

function equivalentEngineScore(a?: EngineLine, b?: EngineLine) {
  if (!a || !b) return false;
  const cpA = a.score.match(/cp\s+(-?\d+)/);
  const cpB = b.score.match(/cp\s+(-?\d+)/);
  if (cpA && cpB) return Number(cpA[1]) === Number(cpB[1]);
  const mateA = a.score.match(/mate\s+(-?\d+)/);
  const mateB = b.score.match(/mate\s+(-?\d+)/);
  return !!mateA && !!mateB && Number(mateA[1]) === Number(mateB[1]);
}

function moveTheme(move: Move) {
  const notation = moveName(move);
  if (move.captured)
    return `${notation}用${move.piece.name}吃掉了对方${move.captured.name}，直接改变了双方子力和战术关系`;
  if (
    move.piece.name === "炮" &&
    move.to[0] === 4 &&
    move.from[0] !== move.to[0]
  )
    return `${notation}把炮转入中路，增强了对将门和中心线的压力`;
  if (move.piece.name === "炮")
    return `${notation}调整了炮的作用线路，为隔子攻击和后续兑子寻找支点`;
  if (move.piece.name === "马")
    return `${notation}重新安排了马的位置，既要看新控制点，也要确认马腿是否畅通`;
  if (move.piece.name === "车")
    return `${notation}改变了车所控制的直线，重点在于开放线和侵入点`;
  if (move.piece.name === "兵" || move.piece.name === "卒")
    return `${notation}推进了兵卒，获得空间的同时也永久改变了这一线的结构`;
  if (["相", "象", "仕", "士"].includes(move.piece.name))
    return `${notation}调整了防守阵型，并改变了将帅周围的控制点`;
  if (move.piece.name === "帅" || move.piece.name === "将")
    return `${notation}移动了将帅，需要结合对方将军手段判断安全性`;
  return `${notation}改变了这枚棋子的活动范围和相关线路`;
}

function localizedVariation(
  uciMoves: string[],
  pieces: Piece[],
  skip: number,
  limit: number,
  numbered: boolean,
) {
  let position = pieces.map((piece) => ({ ...piece }));
  const names: string[] = [];
  for (const [index, uci] of uciMoves.slice(0, skip + limit).entries()) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) continue;
    const fromX = uci.charCodeAt(0) - 97,
      fromY = 9 - Number(uci[1]);
    const toX = uci.charCodeAt(2) - 97,
      toY = 9 - Number(uci[3]);
    const captured = position.find(
      (piece) => piece.x === toX && piece.y === toY,
    );
    if (index >= skip)
      names.push(
        `${numbered ? `${names.length + 1}.` : ""}${uciMoveToName(uci, position)}${captured ? `（吃${captured.name}）` : ""}`,
      );
    const moving = position.find(
      (piece) => piece.x === fromX && piece.y === fromY,
    );
    if (!moving) continue;
    position = position
      .filter((piece) => !(piece.x === toX && piece.y === toY))
      .map((piece) =>
        piece.id === moving.id ? { ...piece, x: toX, y: toY } : piece,
      );
  }
  return names.join(" → ");
}

function principalVariationText(line: EngineLine | undefined, pieces: Piece[]) {
  return line?.pv
    ? localizedVariation(line.pv.split(/\s+/), pieces, 0, 4, true)
    : "";
}

function positionChange(before: number, after: number, loss: number) {
  if (before >= 30 && after <= -30) return "局面由你方占优转为对方占优";
  if (before >= 30 && after < 30) return "原有优势基本被抹平";
  if (before > -30 && after <= -30) return "均衡局面转为对方占优";
  if (before <= -30 && after < before) return "原有劣势进一步扩大";
  if (loss > 8) return `相对最佳结果，评价下滑了 ${(loss / 100).toFixed(2)}`;
  return "局面评价基本保持稳定";
}

function analyzeMove(
  move: Move | undefined,
  afterLine: EngineLine | undefined,
  state: string,
  depth: number,
  pieces: Piece[],
) {
  if (!move)
    return {
      score: "—",
      grade: "待走",
      summary: "先看全局候选，再选择着法。",
      detail: "落子后，皮卡鱼会比较走前与走后的局面评分。",
      principle: "先比较候选着法，再作决定",
      loss: null as number | null,
    };
  if (state !== "ready")
    return {
      score: "—",
      grade: state === "error" ? "未评分" : "计算中",
      summary: "正在等待皮卡鱼完成复盘。",
      detail:
        state === "error"
          ? "本次计算超时，因此不生成推测性评语。"
          : `皮卡鱼正在以深度 ${depth} 计算走后局面。`,
      principle: "没有可靠评分时，不仓促下结论",
      loss: null as number | null,
    };
  const after = engineCp(afterLine);
  if (move.beforeScore == null || after == null)
    return {
      score: "—",
      grade: "未评分",
      summary: "缺少可比较的引擎评分。",
      detail: "这步棋不会使用手写规则代替皮卡鱼评价。",
      principle: "以可靠计算结果为准",
      loss: null as number | null,
    };
  const afterForMover = -after;
  const loss = move.beforeScore - afterForMover;
  const beforeForRed =
    move.piece.side === "red" ? move.beforeScore : -move.beforeScore;
  const afterForRed =
    move.piece.side === "red" ? afterForMover : -afterForMover;
  const score = `${afterForRed >= 0 ? "+" : ""}${(afterForRed / 100).toFixed(2)}`;
  const beforeText = `${beforeForRed >= 0 ? "+" : ""}${(beforeForRed / 100).toFixed(2)}`;
  const theme = moveTheme(move);
  const variation = principalVariationText(afterLine, pieces);
  const change = positionChange(move.beforeScore, afterForMover, loss);
  const alternative =
    !move.wasEngineBest && move.bestBefore
      ? `落子前皮卡鱼首选是${move.bestBefore}。`
      : "";
  const outlook = variation
    ? `接下来 ${variation.split(" → ").length} 个半回合的一条主变化是：${variation}。按双方最佳应对，落子后的红方视角评分为 ${score}。`
    : `按双方最佳应对，落子后的红方视角评分为 ${score}。`;
  if (move.wasEngineBest)
    return {
      score,
      grade: "最佳",
      summary: `红方视角评分由 ${beforeText} 变为 ${score}。`,
      detail: `${theme}；皮卡鱼在落子前将它排在首位。${outlook}`,
      principle: "首选着法也要继续计算对手最强回应",
      loss,
    };
  if (loss <= 8)
    return {
      score,
      grade: "最佳",
      summary: `红方视角评分由 ${beforeText} 变为 ${score}，基本保持了最佳局面。`,
      detail: `${theme}；${change}。${alternative}${outlook}`,
      principle: "好棋要经得住对手最强回应",
      loss,
    };
  if (loss <= 30)
    return {
      score,
      grade: "优秀",
      summary: `红方视角评分由 ${beforeText} 变为 ${score}，只有轻微波动。`,
      detail: `${theme}；${change}。${alternative}${outlook}`,
      principle: "在多个好棋之间比较细微差别",
      loss,
    };
  if (loss <= 80)
    return {
      score,
      grade: "可行",
      summary: `红方视角评分由 ${beforeText} 变为 ${score}，让出了部分优势。`,
      detail: `${theme}；${change}。${alternative}${outlook}`,
      principle: "落子前检查更强的强制手段",
      loss,
    };
  if (loss <= 150)
    return {
      score,
      grade: "不准确",
      summary: `红方视角评分由 ${beforeText} 变为 ${score}。`,
      detail: `${theme}；${change}。${alternative}${outlook}`,
      principle: "先找将军、吃子与直接威胁",
      loss,
    };
  return {
    score,
    grade: "失误",
    summary: `红方视角评分由 ${beforeText} 变为 ${score}。`,
    detail: `${theme}；${change}。${alternative}${outlook}`,
    principle: "每步都计算对手最强反击",
    loss,
  };
}

function pieceSquare(piece: Piece) {
  return `${String.fromCharCode(97 + piece.x)}${9 - piece.y}`;
}

function legalUciMoves(piece: Piece, pieces: Piece[]) {
  const moves: string[] = [];
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 9; x++) {
      if (isLegal(piece, x, y, pieces))
        moves.push(
          `${pieceSquare(piece)}${String.fromCharCode(97 + x)}${9 - y}`,
        );
    }
  return moves;
}

const fenLetters: Record<string, string> = {
  车: "r",
  马: "n",
  相: "b",
  象: "b",
  仕: "a",
  士: "a",
  帅: "k",
  将: "k",
  炮: "c",
  兵: "p",
  卒: "p",
};

function positionFen(pieces: Piece[], turn: Side, ply: number) {
  const ranks = Array.from({ length: 10 }, (_, y) => {
    let rank = "",
      empty = 0;
    for (let x = 0; x < 9; x++) {
      const piece = pieces.find((p) => p.x === x && p.y === y);
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) {
        rank += empty;
        empty = 0;
      }
      const letter = fenLetters[piece.name];
      rank += piece.side === "red" ? letter.toUpperCase() : letter;
    }
    return rank + (empty || "");
  });
  return `${ranks.join("/")} ${turn === "red" ? "w" : "b"} - - 0 ${Math.floor(ply / 2) + 1}`;
}

function positionAtPly(history: Move[], ply: number, startingPieces = initialPieces) {
  let position = startingPieces.map((piece) => ({ ...piece }));
  for (const move of history.slice(0, ply)) {
    position = position
      .filter((piece) => piece.id !== move.captured?.id)
      .map((piece) =>
        piece.id === move.piece.id
          ? { ...piece, x: move.to[0], y: move.to[1] }
          : piece,
      );
  }
  return position;
}

function buildVariationFrames(
  uciMoves: string[],
  pieces: Piece[],
  title: string,
) {
  let position = pieces.map((piece) => ({ ...piece }));
  const frames: VariationFrame[] = [
    { pieces: position, notation: `${title} · 准备演示`, step: "准备" },
  ];
  // One round contains a move by each side, so nine rounds are at most
  // eighteen plies. Mate PVs normally end early; king capture is also an
  // explicit terminal guard for imported/short engine lines.
  for (const [index, uci] of uciMoves.slice(0, 18).entries()) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) continue;
    const fromX = uci.charCodeAt(0) - 97,
      fromY = 9 - Number(uci[1]);
    const toX = uci.charCodeAt(2) - 97,
      toY = 9 - Number(uci[3]);
    const moving = position.find(
      (piece) => piece.x === fromX && piece.y === fromY,
    );
    if (!moving) continue;
    const notation = uciMoveToName(uci, position);
    const captured = position.find(
      (piece) => piece.x === toX && piece.y === toY,
    );
    const step = `${Math.floor(index / 2) + 1}${index % 2 === 0 ? "a" : "b"}`;
    frames.push({
      pieces: position.map((piece) => ({ ...piece })),
      movingPiece: { ...moving },
      capturedPiece: captured ? { ...captured } : undefined,
      notation,
      step,
      from: [fromX, fromY],
      to: [toX, toY],
    });
    position = position
      .filter((piece) => !(piece.x === toX && piece.y === toY))
      .map((piece) =>
        piece.id === moving.id ? { ...piece, x: toX, y: toY } : piece,
      );
    if (captured?.name === "帅" || captured?.name === "将") break;
  }
  return frames;
}

function uciMoveToName(uci: string, pieces: Piece[]) {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) return uci;
  const fromX = uci.charCodeAt(0) - 97,
    fromY = 9 - Number(uci[1]);
  const toX = uci.charCodeAt(2) - 97,
    toY = 9 - Number(uci[3]);
  const piece = pieces.find((p) => p.x === fromX && p.y === fromY);
  if (!piece) return uci;
  return moveName({
    piece,
    from: [fromX, fromY],
    to: [toX, toY],
    captured: pieces.find((p) => p.x === toX && p.y === toY),
  });
}

function engineCandidates(
  lines: EngineLine[],
  pieces: Piece[],
  sideToMove: Side,
): Candidate[] {
  return [...lines]
    .sort((a, b) => a.multipv - b.multipv)
    .map((line, index) => {
      const [first, ...rest] = line.pv.split(/\s+/);
      const score = redPerspectiveScore(line, sideToMove, "—");
      const fromX = first?.charCodeAt(0) - 97,
        toX = first?.charCodeAt(2) - 97,
        toY = 9 - Number(first?.[3]);
      const fromY = 9 - Number(first?.[1]);
      return {
        move: uciMoveToName(first, pieces),
        score,
        tag: index === 0 ? "皮卡鱼首选" : `深度 ${line.depth}`,
        tone: index === 0 ? "best" : "",
        pv: localizedVariation([first, ...rest], pieces, 1, 4, false),
        uciMoves: [first, ...rest].filter(Boolean).slice(0, 18),
        from: Number.isFinite(fromX + fromY) ? [fromX, fromY] : undefined,
        to: Number.isFinite(fromX + toX + toY) ? [toX, toY] : undefined,
      };
    });
}

function isPseudoLegal(piece: Piece, x: number, y: number, pieces: Piece[]) {
  if (x < 0 || x > 8 || y < 0 || y > 9 || (x === piece.x && y === piece.y))
    return false;
  const target = pieces.find((p) => p.x === x && p.y === y);
  if (target?.side === piece.side) return false;
  const dx = Math.abs(x - piece.x),
    dy = Math.abs(y - piece.y);
  const between = pieces.filter(
    (p) =>
      p.id !== piece.id &&
      ((p.x === piece.x &&
        p.x === x &&
        p.y > Math.min(y, piece.y) &&
        p.y < Math.max(y, piece.y)) ||
        (p.y === piece.y &&
          p.y === y &&
          p.x > Math.min(x, piece.x) &&
          p.x < Math.max(x, piece.x))),
  );
  if (piece.name === "车")
    return (dx === 0 || dy === 0) && between.length === 0;
  if (piece.name === "炮")
    return (dx === 0 || dy === 0) && between.length === (target ? 1 : 0);
  if (piece.name === "马") {
    if (dx * dy !== 2) return false;
    const legX = dx === 2 ? piece.x + (x - piece.x) / 2 : piece.x;
    const legY = dy === 2 ? piece.y + (y - piece.y) / 2 : piece.y;
    return !pieces.some((p) => p.x === legX && p.y === legY);
  }
  if (piece.name === "相" || piece.name === "象")
    return (
      dx === 2 &&
      dy === 2 &&
      (piece.side === "red" ? y >= 5 : y <= 4) &&
      !pieces.some(
        (p) => p.x === (x + piece.x) / 2 && p.y === (y + piece.y) / 2,
      )
    );
  if (piece.name === "仕" || piece.name === "士")
    return (
      dx === 1 &&
      dy === 1 &&
      x >= 3 &&
      x <= 5 &&
      (piece.side === "red" ? y >= 7 : y <= 2)
    );
  if (piece.name === "帅" || piece.name === "将") {
    const flyingCapture =
      x === piece.x &&
      target &&
      (target.name === "帅" || target.name === "将") &&
      between.length === 0;
    return (
      !!flyingCapture ||
      (dx + dy === 1 &&
        x >= 3 &&
        x <= 5 &&
        (piece.side === "red" ? y >= 7 : y <= 2))
    );
  }
  if (piece.name === "兵" || piece.name === "卒") {
    const step = piece.side === "red" ? -1 : 1;
    const crossed = piece.side === "red" ? piece.y <= 4 : piece.y >= 5;
    return (
      (x === piece.x && y - piece.y === step) ||
      (crossed && y === piece.y && dx === 1)
    );
  }
  return false;
}

function isInCheck(side: Side, pieces: Piece[]) {
  const king = pieces.find(
    (piece) =>
      piece.side === side && (piece.name === "帅" || piece.name === "将"),
  );
  if (!king) return true;
  return pieces.some(
    (piece) =>
      piece.side !== side && isPseudoLegal(piece, king.x, king.y, pieces),
  );
}

function isLegal(piece: Piece, x: number, y: number, pieces: Piece[]) {
  if (!isPseudoLegal(piece, x, y, pieces)) return false;
  const captured = pieces.find(
    (candidate) => candidate.x === x && candidate.y === y,
  );
  const next = pieces
    .filter((candidate) => candidate.id !== captured?.id)
    .map((candidate) =>
      candidate.id === piece.id ? { ...candidate, x, y } : candidate,
    );
  return !isInCheck(piece.side, next);
}

function xiangqiOutcome(pieces: Piece[], turn: Side): GameOutcome | null {
  const redKing = pieces.some((piece) => piece.side === "red" && piece.name === "帅");
  const blackKing = pieces.some((piece) => piece.side === "black" && piece.name === "将");
  if (!redKing) return { title: "黑方获胜", detail: "红方的帅已被吃掉。" };
  if (!blackKing) return { title: "红方获胜", detail: "黑方的将已被吃掉。" };
  const hasLegalMove = pieces.some((piece) => piece.side === turn && legalUciMoves(piece, pieces).length > 0);
  if (hasLegalMove) return null;
  const winner = turn === "red" ? "黑方" : "红方";
  return { title: `${winner}获胜`, detail: `${turn === "red" ? "红方" : "黑方"}已无合法着法，${winner}赢得本局。` };
}

function CandidateArrows({
  candidates,
  pieces,
  flipped,
}: {
  candidates: Candidate[];
  pieces: Piece[];
  flipped: boolean;
}) {
  const colors = ["#23945d", "#bd5339", "#3976bd", "#7659a5"];
  return (
    <svg
      className="candidate-arrows"
      viewBox="0 0 8 9"
      preserveAspectRatio="none"
      aria-label="全局候选着法箭头"
    >
      {candidates.slice(0, 4).map((candidate, index) => {
        if (!candidate.from || !candidate.to) return null;
        const [rawFromX, rawFromY] = candidate.from;
        const [rawToX, rawToY] = candidate.to;
        const fromX = flipped ? 8 - rawFromX : rawFromX;
        const fromY = flipped ? 9 - rawFromY : rawFromY;
        const toX = flipped ? 8 - rawToX : rawToX;
        const toY = flipped ? 9 - rawToY : rawToY;
        const dx = toX - fromX,
          dy = toY - fromY;
        const length = Math.hypot(dx, dy);
        if (length < 0.01) return null;
        const ux = dx / length,
          uy = dy / length;
        const targetOccupied = pieces.some(
          (piece) => piece.x === rawToX && piece.y === rawToY,
        );
        const startTrim = Math.min(0.43, length * 0.3);
        const endTrim = targetOccupied ? Math.min(0.43, length * 0.3) : 0;
        const startX = fromX + ux * startTrim,
          startY = fromY + uy * startTrim;
        const endX = toX - ux * endTrim,
          endY = toY - uy * endTrim;
        const visible = Math.hypot(endX - startX, endY - startY);
        const emphasized = index === 0;
        const lineWidth = emphasized ? 0.085 : 0.06;
        const preferredHead = emphasized ? 0.22 : 0.18;
        const headLength = Math.min(preferredHead, visible * 0.46);
        const headWidth = headLength * 0.62;
        const px = -uy,
          py = ux;
        const preferredRadius = emphasized ? 0.18 : 0.15;
        const labelFits = visible > preferredRadius * 2.8 + headLength;
        const radius = labelFits
          ? preferredRadius
          : Math.min(preferredRadius, Math.max(0.1, visible * 0.24));
        const baseX = startX + (endX - startX) * 0.46;
        const baseY = startY + (endY - startY) * 0.46;
        const offset = labelFits ? 0 : index % 2 ? -0.22 : 0.22;
        const labelX = baseX + px * offset,
          labelY = baseY + py * offset;
        const gap = radius + lineWidth * 0.62;
        const beforeX = labelX - ux * gap,
          beforeY = labelY - uy * gap;
        const afterX = labelX + ux * gap,
          afterY = labelY + uy * gap;
        const head = [
          [endX, endY],
          [
            endX - ux * headLength + px * headWidth,
            endY - uy * headLength + py * headWidth,
          ],
          [
            endX - ux * headLength - px * headWidth,
            endY - uy * headLength - py * headWidth,
          ],
        ]
          .map((point) => point.join(","))
          .join(" ");
        const color = colors[index];
        return (
          <g
            key={`${candidate.move}-${index}`}
            className={emphasized ? "primary-arrow" : undefined}
          >
            {labelFits ? (
              <>
                <line
                  x1={startX}
                  y1={startY}
                  x2={beforeX}
                  y2={beforeY}
                  stroke={color}
                  strokeWidth={lineWidth}
                />
                <line
                  x1={afterX}
                  y1={afterY}
                  x2={endX}
                  y2={endY}
                  stroke={color}
                  strokeWidth={lineWidth}
                />
              </>
            ) : (
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke={color}
                strokeWidth={lineWidth}
              />
            )}
            <polygon points={head} fill={color} />
            <circle
              cx={labelX}
              cy={labelY}
              r={radius}
              fill={color}
              stroke="rgba(255,255,255,.94)"
              strokeWidth=".025"
            />
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={radius * 1.08}
              fill="white"
              fontFamily="Arial, sans-serif"
              fontWeight="700"
            >
              {index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MiniBoard({ pieces, flipped }: { pieces: Piece[]; flipped: boolean }) {
  return (
    <div className="mini-board" aria-hidden="true">
      <div className="mini-river" />
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className={`mini-piece ${piece.side}`}
          style={{
            left: `${(flipped ? 8 - piece.x : piece.x) * 12.5}%`,
            top: `${(flipped ? 9 - piece.y : piece.y) * 11.111}%`,
          }}
        >
          {piece.name}
        </span>
      ))}
    </div>
  );
}

function SituationChart({
  points,
  history,
  analyzing,
  activePly,
  flipped,
  onPreviewPly,
  onSelectPly,
  startingPieces,
}: {
  points: EvaluationPoint[];
  history: Move[];
  analyzing: boolean;
  activePly: number;
  flipped: boolean;
  onPreviewPly: (ply: number | null) => void;
  onSelectPly: (ply: number) => void;
  startingPieces: Piece[];
}) {
  const width = 960,
    height = 270;
  const plot = { left: 58, top: 20, right: 942, bottom: 232 };
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [scrubPly, setScrubPly] = useState<number | null>(null);
  const validScores = points.flatMap((point) =>
    point.score == null ? [] : [point.score],
  );
  const largest = validScores.reduce(
    (maximum, score) => Math.max(maximum, Math.abs(score)),
    0,
  );
  const range = Math.max(300, Math.ceil(largest / 100) * 100);
  const finalPly = points.at(-1)?.ply ?? 0;
  const lastPly = Math.max(finalPly, 1);
  const position = (point: EvaluationPoint) => ({
    x: plot.left + (point.ply / lastPly) * (plot.right - plot.left),
    y:
      (plot.top + plot.bottom) / 2 -
      ((Math.max(-range, Math.min(range, point.score ?? 0)) / range) *
        (plot.bottom - plot.top)) /
        2,
  });
  const segments: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    key: string;
  }> = [];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1],
      current = points[index];
    if (
      previous.score == null ||
      current.score == null ||
      current.ply !== previous.ply + 1
    )
      continue;
    const start = position(previous),
      end = position(current);
    if (
      previous.score >= 0 === current.score >= 0 ||
      previous.score === current.score
    ) {
      segments.push({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        color: previous.score + current.score >= 0 ? "#b52f26" : "#222923",
        key: String(index),
      });
    } else {
      const ratio =
        Math.abs(previous.score) /
        (Math.abs(previous.score) + Math.abs(current.score));
      const crossing = {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
      segments.push({
        x1: start.x,
        y1: start.y,
        x2: crossing.x,
        y2: crossing.y,
        color: previous.score >= 0 ? "#b52f26" : "#222923",
        key: `${index}-a`,
      });
      segments.push({
        x1: crossing.x,
        y1: crossing.y,
        x2: end.x,
        y2: end.y,
        color: current.score >= 0 ? "#b52f26" : "#222923",
        key: `${index}-b`,
      });
    }
  }
  const displayedPly = scrubPly ?? activePly;
  const current = points.find((point) => point.ply === displayedPly);
  const activePosition = current ? position(current) : null;

  function plyAtPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds?.width) return displayedPly;
    const viewX = ((event.clientX - bounds.left) / bounds.width) * width;
    const ratio = Math.max(
      0,
      Math.min(1, (viewX - plot.left) / (plot.right - plot.left)),
    );
    return Math.round(ratio * finalPly);
  }

  function beginScrub(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const ply = plyAtPointer(event);
    setScrubPly(ply);
    onPreviewPly(ply);
  }

  function moveScrub(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      scrubPly == null ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    const ply = plyAtPointer(event);
    setScrubPly(ply);
    onPreviewPly(ply);
  }

  function finishScrub(
    event: ReactPointerEvent<SVGSVGElement>,
    commit: boolean,
  ) {
    if (scrubPly == null) return;
    const ply = plyAtPointer(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setScrubPly(null);
    onPreviewPly(null);
    if (commit) onSelectPly(ply);
  }

  return (
    <section className="situation-panel panel">
      <div className="situation-heading">
        <div className="panel-title">
          <span>02</span>
          <div>
            <strong>局势图</strong>
            <small>POSITION TREND</small>
          </div>
        </div>
        <em>
          {scrubPly == null ? "正在查看" : "滑移预览"}：
          {displayedPly === 0 ? "开局" : `第 ${displayedPly} 步后`} · 红方视角
        </em>
      </div>
      <p>
        按住并左右滑移可快速预览任意一步，松开后返回该局面；轻点仍可直接选择。
      </p>
      <div className="situation-chart-wrap">
        <svg
          ref={svgRef}
          className={`situation-chart ${scrubPly == null ? "" : "scrubbing"}`}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="皮卡鱼局势评分曲线"
          onPointerDown={beginScrub}
          onPointerMove={moveScrub}
          onPointerUp={(event) => finishScrub(event, true)}
          onPointerCancel={(event) => finishScrub(event, false)}
        >
          {[-1, -0.5, 0, 0.5, 1].map((fraction) => {
            const y =
              (plot.top + plot.bottom) / 2 -
              (fraction * (plot.bottom - plot.top)) / 2;
            const value = Math.round(range * fraction);
            return (
              <g key={fraction}>
                <line
                  x1={plot.left}
                  y1={y}
                  x2={plot.right}
                  y2={y}
                  className={fraction === 0 ? "zero-line" : "grid-line"}
                />
                <text x={plot.left - 10} y={y + 4} textAnchor="end">
                  {value === 0
                    ? "0"
                    : `${value > 0 ? "+" : ""}${(value / 100).toFixed(1)}`}
                </text>
              </g>
            );
          })}
          <text x={plot.left} y={14} className="red-advantage">
            红优
          </text>
          <text x={plot.left} y={height - 6} className="black-advantage">
            黑优
          </text>
          <text x={plot.left} y={height - 6} dx="36">
            0
          </text>
          <text x={plot.right} y={height - 6} textAnchor="end">
            {points.at(-1)?.ply ?? 0} 步
          </text>
          {segments.map((segment) => (
            <line
              key={segment.key}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke={segment.color}
              className="trend-line"
            />
          ))}
          {activePosition && (
            <line
              x1={activePosition.x}
              y1={plot.top}
              x2={activePosition.x}
              y2={plot.bottom}
              className="active-ply-line"
            />
          )}
          {points.map((point) => {
            const spot = position(point);
            const isCurrent = point.ply === displayedPly;
            const stepWidth = (plot.right - plot.left) / lastPly;
            const hitX = Math.max(plot.left, spot.x - stepWidth / 2);
            const hitWidth = Math.max(
              1,
              Math.min(plot.right, spot.x + stepWidth / 2) - hitX,
            );
            const scoreText =
              point.score == null
                ? "评分缺失"
                : `${point.score >= 0 ? "+" : ""}${(point.score / 100).toFixed(2)}`;
            return (
              <g
                key={point.ply}
                className={`trend-point ${isCurrent ? "active" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`${point.ply === 0 ? "开局" : `第 ${point.ply} 步后`}，${scoreText}`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectPly(point.ply);
                  }
                }}
              >
                <rect
                  x={hitX}
                  y={plot.top}
                  width={hitWidth}
                  height={plot.bottom - plot.top}
                  className="trend-hit-area"
                />
                {point.score == null ? (
                  <circle
                    cx={spot.x}
                    cy={spot.y}
                    r={isCurrent ? 7 : 4}
                    className="missing-point"
                  />
                ) : (
                  <circle
                    cx={spot.x}
                    cy={spot.y}
                    r={isCurrent ? 8 : 4}
                    fill={
                      isCurrent
                        ? "#168251"
                        : point.score >= 0
                          ? "#b52f26"
                          : "#222923"
                    }
                  />
                )}
                {isCurrent && (
                  <circle
                    cx={spot.x}
                    cy={spot.y}
                    r="14"
                    className="current-halo"
                  />
                )}
              </g>
            );
          })}
          {!validScores.length && (
            <text
              x={(plot.left + plot.right) / 2}
              y={(plot.top + plot.bottom) / 2}
              textAnchor="middle"
              className="empty-chart"
            >
              {analyzing
                ? "正在计算首个局面评分…"
                : "落子后将在这里生成评分曲线"}
            </text>
          )}
          {!!validScores.length && analyzing && current?.score == null && (
            <text
              x={plot.right}
              y={plot.top + 14}
              textAnchor="end"
              className="empty-chart"
            >
              当前点计算中…
            </text>
          )}
        </svg>
        {scrubPly != null && (
          <div className="timeline-preview">
            <MiniBoard
              pieces={positionAtPly(history, scrubPly, startingPieces)}
              flipped={flipped}
            />
            <strong>{scrubPly === 0 ? "开局" : `第 ${scrubPly} 步后`}</strong>
            <span>
              {current?.score == null
                ? "暂无评分"
                : `红方视角 ${current.score >= 0 ? "+" : ""}${(current.score / 100).toFixed(2)}`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  const [pieces, setPieces] = useState(initialPieces);
  const [startingPieces, setStartingPieces] = useState<Piece[]>(initialPieces);
  const [startingTurn, setStartingTurn] = useState<Side>("red");
  const [recordTitle, setRecordTitle] = useState("新对局");
  const [recordMessage, setRecordMessage] = useState("");
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [showRecordPanel, setShowRecordPanel] = useState(false);
  const [fenInput, setFenInput] = useState("");
  const [savedGames, setSavedGames] = useState<Array<{ id: string; title: string; savedAt: string }>>(() => {
    if (typeof window === "undefined") return [];
    try {
      const index = JSON.parse(localStorage.getItem("yisi-xiangqi-saves") || "[]");
      return Array.isArray(index) ? index : [];
    } catch { return []; }
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [turn, setTurn] = useState<Side>("red");
  const [history, setHistory] = useState<Move[]>([]);
  const [activePly, setActivePly] = useState(0);
  // Keep the installed PWA responsive by default; deeper searches remain
  // available in the analysis settings.
  const [analysisDepth, setAnalysisDepth] = useState<number>(8);
  const [gameMode, setGameMode] = useState<GameMode>("local");
  const [humanSide, setHumanSide] = useState<Side>("red");
  const [computerElo, setComputerElo] = useState(2100);
  const [setupBrush, setSetupBrush] = useState<SetupBrush>("move");
  const [setupMessage, setSetupMessage] = useState("");
  const [showBestArrows, setShowBestArrows] = useState(false);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [variationPreview, setVariationPreview] =
    useState<VariationPreview | null>(null);
  const [previewedCandidateMove, setPreviewedCandidateMove] = useState<
    string | null
  >(null);
  const [timelinePreviewPly, setTimelinePreviewPly] = useState<number | null>(
    null,
  );
  const [engineConnected, setEngineConnected] = useState(false);
  const [engineState, setEngineState] = useState<
    "loading" | "ready" | "thinking" | "error"
  >("loading");
  const [engineMode, setEngineMode] = useState<"native" | "wasm">("wasm");
  const [engineThreads, setEngineThreads] = useState<number | null>(null);
  const [engineDownload, setEngineDownload] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [engineLines, setEngineLines] = useState<EngineLine[]>([]);
  const [positionScores, setPositionScores] = useState<Record<number, number>>(
    {},
  );
  const [backfillVersion, setBackfillVersion] = useState(0);
  const [workerGeneration, setWorkerGeneration] = useState(0);
  const [selectedEngineLines, setSelectedEngineLines] = useState<EngineLine[]>(
    [],
  );
  const [selectedEngineState, setSelectedEngineState] = useState<
    "idle" | "thinking" | "ready" | "error"
  >("idle");
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const selectedRequestRef = useRef(100000);
  const outcome = gameMode === "setup" ? null : xiangqiOutcome(pieces, turn);

  function restartEngineWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setEngineConnected(false);
    setEngineState("loading");
    setWorkerGeneration((value) => value + 1);
  }
  const outcomeTitle = outcome?.title;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidateClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const analysisContextRef = useRef({ id: 0, ply: 0, side: "red" as Side });
  const backfillRef = useRef({
    id: 200000,
    ply: 0,
    side: "red" as Side,
    busy: false,
  });
  const boardSectionRef = useRef<HTMLDivElement | null>(null);
  const recordFileRef = useRef<HTMLInputElement | null>(null);
  const setupIdRef = useRef(1);
  const aiPositionRef = useRef("");
  const selectedPiece = pieces.find((p) => p.id === selected);
  const lastMove = activePly > 0 ? history[activePly - 1] : undefined;
  const scoredLastMove = useMemo(() => {
    if (!lastMove) return undefined;
    const redScore = positionScores[activePly - 1];
    return redScore == null
      ? lastMove
      : {
          ...lastMove,
          beforeScore: lastMove.piece.side === "red" ? redScore : -redScore,
        };
  }, [lastMove, positionScores, activePly]);
  const analysis = useMemo(
    () =>
      analyzeMove(
        scoredLastMove,
        engineLines[0],
        engineState,
        analysisDepth,
        pieces,
      ),
    [scoredLastMove, engineLines, engineState, analysisDepth, pieces],
  );

  const candidates = useMemo(
    () =>
      engineLines.length ? engineCandidates(engineLines, pieces, turn) : [],
    [engineLines, pieces, turn],
  );
  const pieceOptions = useMemo(
    () =>
      selectedPiece && selectedEngineLines.length
        ? engineCandidates(selectedEngineLines, pieces, turn)
        : [],
    [selectedPiece, selectedEngineLines, pieces, turn],
  );
  const shownCandidates = selectedPiece ? pieceOptions : candidates;
  const globalBestLine = useMemo(
    () => [...engineLines].sort((a, b) => a.multipv - b.multipv)[0],
    [engineLines],
  );
  const selectedBestLine = useMemo(
    () => [...selectedEngineLines].sort((a, b) => a.multipv - b.multipv)[0],
    [selectedEngineLines],
  );
  const selectedIsGlobalBest =
    !!selectedPiece &&
    !!selectedBestLine &&
    !!globalBestLine &&
    (selectedBestLine.pv.split(/\s+/)[0] ===
      globalBestLine.pv.split(/\s+/)[0] ||
      equivalentEngineScore(selectedBestLine, globalBestLine));
  const globalAlternatives = selectedPiece
    ? candidates.filter((c) => c.move !== pieceOptions[0]?.move).slice(0, 3)
    : [];
  const currentPositionScore = redPerspectiveScore(engineLines[0], turn);
  const variationFrame = variationPreview?.frames[variationPreview.index];
  const previewingBoard =
    variationPreview != null || timelinePreviewPly != null;
  const displayPieces = variationFrame
    ? variationFrame.pieces.filter(
        (piece) =>
          piece.id !== variationFrame.movingPiece?.id &&
          piece.id !== variationFrame.capturedPiece?.id,
      )
    : timelinePreviewPly == null
      ? pieces
      : positionAtPly(history, timelinePreviewPly, startingPieces);
  const evaluationPoints = useMemo<EvaluationPoint[]>(() => {
    const currentScore = engineCp(engineLines[0]);
    return Array.from({ length: history.length + 1 }, (_, ply) => {
      const followingMove = history[ply];
      let score =
        positionScores[ply] ??
        (followingMove?.beforeScore == null
          ? null
          : followingMove.piece.side === "red"
            ? followingMove.beforeScore
            : -followingMove.beforeScore);
      if (ply === activePly && currentScore != null)
        score = turn === "red" ? currentScore : -currentScore;
      return { ply, score };
    });
  }, [history, engineLines, turn, activePly, positionScores]);

  useEffect(() => {
    if (!variationPreview) return;
    const finalIndex = variationPreview.frames.length - 1;
    const delay =
      variationPreview.index === 0
        ? 420
        : variationPreview.index >= finalIndex
          ? 1350
          : 880;
    const timer = setTimeout(() => {
      setVariationPreview((current) => {
        if (!current) return null;
        if (current.index >= current.frames.length - 1) return null;
        return { ...current, index: current.index + 1 };
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [variationPreview]);

  useEffect(() => {
    const worker = new Worker("/pikafish/engine-worker.js");
    workerRef.current = worker;
    worker.onmessage = (event) => {
      if (event.data?.type === "download-progress") {
        const loaded = Number(event.data.loaded) || 0;
        const total = Number(event.data.total) || 1;
        setEngineDownload(event.data.complete ? null : { loaded, total });
      }
      if (event.data?.type === "ready") {
        setEngineDownload(null);
        setEngineMode(event.data.mode === "native" ? "native" : "wasm");
        setEngineThreads(Number(event.data.threads) || null);
        setEngineConnected(true);
        setEngineState("ready");
      }
      if (
        event.data?.type === "analysis" &&
        event.data.scope === "global" &&
        event.data.id === requestRef.current
      ) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        const lines = event.data.lines ?? [];
        setEngineLines(lines);
        const context = analysisContextRef.current;
        const score = engineCp(lines[0]);
        if (context.id === event.data.id && score != null)
          setPositionScores((current) => ({
            ...current,
            [context.ply]: context.side === "red" ? score : -score,
          }));
        setEngineState("ready");
      }
      if (
        event.data?.type === "analysis" &&
        event.data.scope === "backfill" &&
        event.data.id === backfillRef.current.id
      ) {
        const lines = event.data.lines ?? [];
        const score = engineCp(lines[0]);
        const context = backfillRef.current;
        context.busy = false;
        if (score != null)
          setPositionScores((current) => ({
            ...current,
            [context.ply]: context.side === "red" ? score : -score,
          }));
        setBackfillVersion((value) => value + 1);
      }
      if (
        event.data?.type === "analysis" &&
        event.data.scope === "selected" &&
        event.data.id === selectedRequestRef.current
      ) {
        if (selectedTimeoutRef.current)
          clearTimeout(selectedTimeoutRef.current);
        setSelectedEngineLines(event.data.lines ?? []);
        setSelectedEngineState("ready");
      }
      if (
        event.data?.type === "error" &&
        event.data.scope === "selected" &&
        event.data.id === selectedRequestRef.current
      ) {
        if (selectedTimeoutRef.current)
          clearTimeout(selectedTimeoutRef.current);
        setSelectedEngineLines([]);
        setSelectedEngineState("error");
      }
      if (
        event.data?.type === "error" &&
        event.data.scope === "backfill" &&
        event.data.id === backfillRef.current.id
      ) {
        backfillRef.current.busy = false;
        setBackfillVersion((value) => value + 1);
      }
      if (
        event.data?.type === "error" &&
        event.data.scope !== "selected" &&
        (event.data.id == null || event.data.id === requestRef.current)
      ) {
        setEngineDownload(null);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setEngineLines([]);
        setEngineState("error");
      }
    };
    worker.onerror = () => {
      setEngineDownload(null);
      setEngineState("error");
    };
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (selectedTimeoutRef.current) clearTimeout(selectedTimeoutRef.current);
      if (candidateClickTimeoutRef.current)
        clearTimeout(candidateClickTimeoutRef.current);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [workerGeneration]);

  useEffect(() => {
    if (!workerRef.current || !engineConnected) return;
    if (gameMode === "setup" || outcomeTitle) {
      workerRef.current.postMessage({ type: "stop" });
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    workerRef.current.postMessage({ type: "stop" });
    backfillRef.current.busy = false;
    backfillRef.current.id++;
    const id = ++requestRef.current;
    analysisContextRef.current = { id, ply: activePly, side: turn };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- position changes intentionally start a new external engine request.
    setEngineState("thinking");
    setEngineLines([]);
    workerRef.current.postMessage({
      type: "analyze",
      scope: "global",
      id,
      fen: positionFen(pieces, turn, activePly),
      depth: analysisDepth,
      multiPV: gameMode === "computer" && turn !== humanSide ? 1 : 3,
      elo: gameMode === "computer" && turn !== humanSide ? computerElo : 0,
    });
    timeoutRef.current = setTimeout(() => {
      if (id !== requestRef.current) return;
      requestRef.current++;
      restartEngineWorker();
    }, 45000);
  }, [pieces, turn, activePly, analysisDepth, engineConnected, gameMode, humanSide, computerElo, outcomeTitle]);

  useEffect(() => {
    if (
      !workerRef.current ||
      !engineConnected ||
      engineState !== "ready" ||
      selectedPiece ||
      gameMode === "setup" ||
      backfillRef.current.busy
    )
      return;
    const missingPly = Array.from(
      { length: history.length + 1 },
      (_, ply) => ply,
    ).find((ply) => ply !== activePly && positionScores[ply] == null);
    if (missingPly == null) return;
    const side = sideAfterPly(startingTurn, missingPly);
    const id = ++backfillRef.current.id;
    backfillRef.current = { id, ply: missingPly, side, busy: true };
    workerRef.current.postMessage({
      type: "analyze",
      scope: "backfill",
      id,
      fen: positionFen(positionAtPly(history, missingPly, startingPieces), side, missingPly),
      depth: Math.min(10, analysisDepth),
      multiPV: 1,
    });
  }, [
    engineConnected,
    engineState,
    selectedPiece,
    gameMode,
    history,
    activePly,
    analysisDepth,
    backfillVersion,
    positionScores,
    startingPieces,
    startingTurn,
  ]);

  useEffect(() => {
    if (selectedTimeoutRef.current) clearTimeout(selectedTimeoutRef.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selection changes start a new external engine request.
    setSelectedEngineLines([]);
    if (gameMode === "setup" || !selectedPiece) {
      setSelectedEngineState("idle");
      return;
    }
    if (!workerRef.current || engineState !== "ready") {
      setSelectedEngineState(engineState === "error" ? "error" : "thinking");
      return;
    }
    const searchMoves = legalUciMoves(selectedPiece, pieces);
    if (!searchMoves.length) {
      setSelectedEngineState("ready");
      return;
    }
    const id = ++selectedRequestRef.current;
    setSelectedEngineState("thinking");
    backfillRef.current.busy = false;
    backfillRef.current.id++;
    workerRef.current.postMessage({ type: "stop" });
    workerRef.current.postMessage({
      type: "analyze",
      scope: "selected",
      id,
      fen: positionFen(pieces, turn, activePly),
      depth: analysisDepth,
      multiPV: Math.min(12, searchMoves.length),
      searchMoves,
    });
    selectedTimeoutRef.current = setTimeout(() => {
      if (id !== selectedRequestRef.current) return;
      selectedRequestRef.current++;
      workerRef.current?.postMessage({ type: "stop" });
      setSelectedEngineLines([]);
      setSelectedEngineState("error");
    }, 45000);
  }, [
    selectedPiece,
    pieces,
    turn,
    activePly,
    analysisDepth,
    engineState,
    gameMode,
  ]);

  useEffect(() => {
    if (
      gameMode !== "computer" ||
      outcomeTitle ||
      turn === humanSide ||
      engineState !== "ready" ||
      !candidates[0]
    )
      return;
    const positionKey = positionFen(pieces, turn, activePly);
    if (aiPositionRef.current === positionKey) return;
    aiPositionRef.current = positionKey;
    const candidate = candidates[0];
    const timer = setTimeout(() => {
      if (!candidate.from || !candidate.to) return;
      const piece = pieces.find(
        (item) =>
          item.x === candidate.from?.[0] &&
          item.y === candidate.from?.[1] &&
          item.side === turn,
      );
      if (piece) playMove(piece, candidate.to[0], candidate.to[1]);
    }, 520);
    return () => clearTimeout(timer);
    // playMove intentionally reads the position snapshot captured by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, humanSide, turn, engineState, candidates, pieces, activePly, outcomeTitle]);

  function clickPoint(x: number, y: number) {
    if (previewingBoard) {
      setVariationPreview(null);
      setTimelinePreviewPly(null);
      return;
    }
    if (gameMode === "setup") {
      editSetupSquare(x, y);
      return;
    }
    if (outcome) return;
    if (gameMode === "computer" && turn !== humanSide) return;
    const here = pieces.find((p) => p.x === x && p.y === y);
    if (!selectedPiece) {
      if (here?.side === turn) {
        setPreviewedCandidateMove(null);
        setSelected(here.id);
      }
      return;
    }
    if (here?.side === turn) {
      setPreviewedCandidateMove(null);
      setSelected(here.id);
      return;
    }
    if (!isLegal(selectedPiece, x, y, pieces)) return;
    playMove(selectedPiece, x, y);
  }

  function playMove(piece: Piece, x: number, y: number) {
    if (outcome || piece.side !== turn || !isLegal(piece, x, y, pieces)) return;
    setVariationPreview(null);
    setPreviewedCandidateMove(null);
    setTimelinePreviewPly(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (selectedTimeoutRef.current) clearTimeout(selectedTimeoutRef.current);
    requestRef.current++;
    selectedRequestRef.current++;
    // A synchronous WASM search cannot process a queued stop until it returns.
    // Recreate it so the legal move takes priority and the new position starts
    // analysis immediately.
    if (engineState === "thinking" && engineMode === "wasm")
      restartEngineWorker();
    else workerRef.current?.postMessage({ type: "stop" });
    const captured = pieces.find((p) => p.x === x && p.y === y);
    const playedUci = `${pieceSquare(piece)}${String.fromCharCode(97 + x)}${9 - y}`;
    const bestUci = engineLines[0]?.pv.split(/\s+/)[0];
    const move: Move = {
      piece: { ...piece },
      from: [piece.x, piece.y],
      to: [x, y],
      captured,
      beforeScore: engineCp(engineLines[0]) ?? undefined,
      wasEngineBest: bestUci === playedUci,
      bestBefore: bestUci ? uciMoveToName(bestUci, pieces) : undefined,
    };
    const nextPieces = pieces
      .filter((p) => p.id !== captured?.id)
      .map((p) => (p.id === piece.id ? { ...p, x, y } : p));
    const nextTurn = turn === "red" ? "black" : "red";
    setPieces(nextPieces);
    if (xiangqiOutcome(nextPieces, nextTurn)) setOutcomeOpen(true);
    setHistory((h) => [...h.slice(0, activePly), move]);
    setPositionScores((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([ply]) => Number(ply) <= activePly),
      ),
    );
    setActivePly(activePly + 1);
    setSelected(null);
    setSelectedEngineLines([]);
    setEngineLines([]);
    setEngineState("thinking");
    setTurn(nextTurn);
  }

  function playCandidate(candidate: Candidate) {
    if (candidateClickTimeoutRef.current)
      clearTimeout(candidateClickTimeoutRef.current);
    setVariationPreview(null);
    if (
      !candidate.from ||
      !candidate.to ||
      engineState !== "ready" ||
      gameMode === "setup" ||
      (gameMode === "computer" && turn !== humanSide)
    )
      return;
    const piece = pieces.find(
      (p) =>
        p.x === candidate.from?.[0] &&
        p.y === candidate.from?.[1] &&
        p.side === turn,
    );
    if (piece) playMove(piece, candidate.to[0], candidate.to[1]);
  }

  function previewCandidate(candidate: Candidate) {
    const frames = buildVariationFrames(
      candidate.uciMoves,
      pieces,
      candidate.move,
    );
    if (frames.length < 2) return;
    setTimelinePreviewPly(null);
    setPreviewedCandidateMove(candidate.uciMoves[0] ?? null);
    setVariationPreview({ title: candidate.move, frames, index: 0 });
    requestAnimationFrame(() =>
      boardSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  }

  function scheduleCandidatePreview(candidate: Candidate) {
    if (candidateClickTimeoutRef.current)
      clearTimeout(candidateClickTimeoutRef.current);
    candidateClickTimeoutRef.current = setTimeout(
      () => previewCandidate(candidate),
      260,
    );
  }

  function previewTimeline(ply: number | null) {
    if (ply != null) setVariationPreview(null);
    setTimelinePreviewPly(ply);
  }

  function goToPly(ply: number) {
    const targetPly = Math.max(0, Math.min(history.length, ply));
    setTimelinePreviewPly(null);
    setVariationPreview(null);
    setPreviewedCandidateMove(null);
    if (targetPly === activePly) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (selectedTimeoutRef.current) clearTimeout(selectedTimeoutRef.current);
    requestRef.current++;
    selectedRequestRef.current++;
    workerRef.current?.postMessage({ type: "stop" });
    setPieces(positionAtPly(history, targetPly, startingPieces));
    setActivePly(targetPly);
    setTurn(sideAfterPly(startingTurn, targetPly));
    setSelected(null);
    setSelectedEngineLines([]);
    setSelectedEngineState("idle");
    setEngineLines([]);
    setEngineState("thinking");
  }

  function undo() {
    if (activePly === 0) return;
    goToPly(activePly - 1);
  }

  function reset() {
    requestRef.current++;
    selectedRequestRef.current++;
    workerRef.current?.postMessage({ type: "stop" });
    setOutcomeOpen(false);
    setPieces(initialPieces);
    setStartingPieces(initialPieces);
    setStartingTurn("red");
    setRecordTitle("新对局");
    setRecordMessage("");
    setHistory([]);
    setPositionScores({});
    setActivePly(0);
    setTurn("red");
    setSelected(null);
    setEngineLines([]);
    setSelectedEngineLines([]);
    setEngineState("thinking");
    setVariationPreview(null);
    setPreviewedCandidateMove(null);
    setTimelinePreviewPly(null);
    aiPositionRef.current = "";
  }

  function refreshSavedGames() {
    try {
      const index = JSON.parse(localStorage.getItem("yisi-xiangqi-saves") || "[]");
      setSavedGames(Array.isArray(index) ? index : []);
    } catch {
      setSavedGames([]);
    }
  }

  function installRecord(
    imported: { title: string; pieces: Piece[]; turn: Side; moves: Array<{ from: [number, number]; to: [number, number] }> },
    scores: Record<number, number> = {},
    requestedPly?: number,
  ) {
    let position = imported.pieces.map((piece) => ({ ...piece }));
    const importedHistory: Move[] = [];
    for (const coordinates of imported.moves) {
      const moving = position.find((piece) => piece.x === coordinates.from[0] && piece.y === coordinates.from[1]);
      if (!moving) throw new Error(`第 ${importedHistory.length + 1} 步的起点没有棋子。`);
      const captured = position.find((piece) => piece.x === coordinates.to[0] && piece.y === coordinates.to[1]);
      importedHistory.push({ piece: { ...moving }, from: coordinates.from, to: coordinates.to, captured: captured ? { ...captured } : undefined });
      position = position
        .filter((piece) => piece.id !== captured?.id)
        .map((piece) => piece.id === moving.id ? { ...piece, x: coordinates.to[0], y: coordinates.to[1] } : piece);
    }
    const targetPly = Math.max(0, Math.min(requestedPly ?? importedHistory.length, importedHistory.length));
    requestRef.current++;
    selectedRequestRef.current++;
    workerRef.current?.postMessage({ type: "stop" });
    setStartingPieces(imported.pieces.map((piece) => ({ ...piece })));
    setStartingTurn(imported.turn);
    setHistory(importedHistory);
    setPositionScores(scores);
    setActivePly(targetPly);
    setPieces(positionAtPly(importedHistory, targetPly, imported.pieces));
    setTurn(sideAfterPly(imported.turn, targetPly));
    setRecordTitle(imported.title || "导入棋局");
    setGameMode("local");
    setSelected(null);
    setEngineLines([]);
    setSelectedEngineLines([]);
    setVariationPreview(null);
    setTimelinePreviewPly(null);
    setEngineState("thinking");
    setShowRecordPanel(false);
    setRecordMessage(`已载入“${imported.title || "导入棋局"}”，共 ${importedHistory.length} 步；可前后浏览或从当前局面续走。`);
  }

  async function importRecordFile(file: File) {
    try {
      if (/\.xqf$/i.test(file.name)) installRecord(parseXqf(await file.arrayBuffer(), file.name) as Parameters<typeof installRecord>[0]);
      else if (/\.json$/i.test(file.name)) {
        const saved = JSON.parse(await file.text());
        if (saved?.version !== SAVED_GAME_VERSION) throw new Error("不支持此弈思存档版本。 ");
        installRecord(saved.record, saved.positionScores || {}, saved.activePly);
      } else installRecord(parseFen(await file.text()) as Parameters<typeof installRecord>[0]);
    } catch (error) {
      setRecordMessage(error instanceof Error ? error.message : "棋谱载入失败。 ");
    } finally {
      if (recordFileRef.current) recordFileRef.current.value = "";
    }
  }

  function importFenText() {
    try { installRecord(parseFen(fenInput) as Parameters<typeof installRecord>[0]); }
    catch (error) { setRecordMessage(error instanceof Error ? error.message : "FEN 载入失败。 "); }
  }

  function saveGame() {
    const id = `game-${Date.now()}`;
    const savedAt = new Date().toISOString();
    const title = recordTitle === "新对局" ? `象棋对局 ${new Date().toLocaleString("zh-CN")}` : recordTitle;
    const record = {
      title,
      pieces: startingPieces,
      turn: startingTurn,
      moves: history.map((move) => ({ from: move.from, to: move.to })),
    };
    localStorage.setItem(`yisi-xiangqi-save:${id}`, JSON.stringify({ version: SAVED_GAME_VERSION, record, activePly, positionScores }));
    const next = [{ id, title, savedAt }, ...savedGames].slice(0, 20);
    localStorage.setItem("yisi-xiangqi-saves", JSON.stringify(next));
    setSavedGames(next);
    setRecordTitle(title);
    setRecordMessage(`已保存“${title}”，下次打开本浏览器仍可载入。`);
  }

  function loadSavedGame(id: string) {
    try {
      const saved = JSON.parse(localStorage.getItem(`yisi-xiangqi-save:${id}`) || "null");
      if (!saved) throw new Error("找不到这份本地存档。 ");
      installRecord(saved.record, saved.positionScores || {}, saved.activePly);
    } catch (error) { setRecordMessage(error instanceof Error ? error.message : "存档载入失败。 "); }
  }

  function changeDepth(depth: number) {
    if (depth === analysisDepth) return;
    selectedRequestRef.current++;
    if (engineState === "thinking") restartEngineWorker();
    setSelected(null);
    setPreviewedCandidateMove(null);
    setSelectedEngineLines([]);
    setAnalysisDepth(depth);
  }

  function changeGameMode(mode: GameMode) {
    if (mode === gameMode) return;
    requestRef.current++;
    selectedRequestRef.current++;
    // A synchronous WASM search cannot process a queued stop until it returns.
    // Recreate it so the legal move takes priority and the new position starts
    // analysis immediately.
    if (engineState === "thinking" && engineMode === "wasm")
      restartEngineWorker();
    else workerRef.current?.postMessage({ type: "stop" });
    setVariationPreview(null);
    setTimelinePreviewPly(null);
    setSelected(null);
    setSelectedEngineLines([]);
    setPreviewedCandidateMove(null);
    setSetupMessage("");
    aiPositionRef.current = "";
    if (mode === "setup") {
      setHistory([]);
      setPositionScores({});
      setActivePly(0);
      setSetupBrush("move");
      setEngineLines([]);
      setEngineState("ready");
    }
    setGameMode(mode);
  }

  function editSetupSquare(x: number, y: number) {
    const here = pieces.find((piece) => piece.x === x && piece.y === y);
    setSetupMessage("");
    if (setupBrush === "erase") {
      setPieces((current) =>
        current.filter((piece) => !(piece.x === x && piece.y === y)),
      );
      if (here?.id === selected) setSelected(null);
      return;
    }
    if (setupBrush === "move") {
      if (!selectedPiece) {
        if (here) setSelected(here.id);
        return;
      }
      if (selectedPiece.x === x && selectedPiece.y === y) {
        setSelected(null);
        return;
      }
      setPieces((current) =>
        current
          .filter((piece) => !(piece.x === x && piece.y === y))
          .map((piece) =>
            piece.id === selectedPiece.id ? { ...piece, x, y } : piece,
          ),
      );
      setSelected(null);
      return;
    }
    const brush = setupBrush;
    const id = `setup-${brush.side}-${setupIdRef.current++}`;
    setPieces((current) => [
      ...current.filter((piece) => !(piece.x === x && piece.y === y)),
      { id, side: brush.side, name: brush.name, x, y },
    ]);
  }

  function finishSetup() {
    const redKings = pieces.filter(
      (piece) => piece.side === "red" && piece.name === "帅",
    ).length;
    const blackKings = pieces.filter(
      (piece) => piece.side === "black" && piece.name === "将",
    ).length;
    if (redKings !== 1 || blackKings !== 1) {
      setSetupMessage("红帅和黑将必须各保留一枚。");
      return;
    }
    setStartingPieces(pieces.map((piece) => ({ ...piece })));
    setStartingTurn(turn);
    setRecordTitle("自定义局面");
    changeGameMode("local");
  }

  return (
    <main>
      <header>
        <div className="brand">
          <span className="seal">象</span>
          <div>
            <strong>弈思</strong>
            <small>象棋思考教练 · HTML</small>
          </div>
        </div>
        <div className={`status engine-${engineState}`}>
          <i />{" "}
          {gameMode === "setup"
            ? "摆盘模式 · 已暂停分析"
            : gameMode === "computer" && turn !== humanSide
              ? "电脑正在思考应着"
              : engineState === "loading"
                ? "正在连接皮卡鱼"
                : engineState === "thinking"
                  ? `${engineMode === "native" ? "本地" : "浏览器"}皮卡鱼深度 ${analysisDepth} 计算中`
                  : engineState === "error"
                    ? "皮卡鱼计算超时 · 暂无可靠评分"
                    : `${engineMode === "native" ? `本地原生皮卡鱼 · ${engineThreads ?? 1}线程 · NNUE已本地加载` : "浏览器皮卡鱼"}已就绪`}
        </div>
      </header>

      {recordMessage && <div className="record-message" role="status"><span>{recordMessage}</span><button onClick={() => setRecordMessage("")}>×</button></div>}

      <section className="workspace">
        <div className="board-wrap" ref={boardSectionRef}>
          <div className="board-top">
            <div className="history-tools">
              <button onClick={undo} disabled={activePly === 0} aria-label="悔棋" title="悔棋">↶</button>
              <button onClick={() => goToPly(activePly + 1)} disabled={activePly >= history.length} aria-label="前进" title="前进">↷</button>
            </div>
            <button className={`best-toggle ${showBestArrows ? "active" : ""}`} onClick={() => setShowBestArrows((value) => !value)} disabled={engineState !== "ready" || !candidates.length} aria-pressed={showBestArrows} aria-label={showBestArrows ? "隐藏全局候选箭头" : "显示全局候选箭头"}>优</button>
            <div className="turn-label">
              <b className={turn === "red" ? "active red-turn" : "black-turn"}>
                {turn === "red" ? "红方" : "黑方"}
              </b>
              <span>走棋</span>
            </div>
            <div className="tools">
              <button onClick={() => setBoardFlipped((value) => !value)} aria-label="切换红黑视角" title="切换视角">⇅</button>
              <button onClick={reset} aria-label="重开" title="重开">↻</button>
            </div>
          </div>
          <div
            className={`board-coordinates top-coordinates ${boardFlipped ? "red-coordinates" : "black-coordinates"}`}
            aria-label={boardFlipped ? "红方路数" : "黑方路数"}
          >
            {(boardFlipped
              ? ["一", "二", "三", "四", "五", "六", "七", "八", "九"]
              : ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
            ).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="board" aria-label="中国象棋棋盘">
            <svg
              className="board-lines"
              viewBox="0 0 8 9"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M0 0H8V9H0Z M0 1H8 M0 2H8 M0 3H8 M0 4H8 M0 5H8 M0 6H8 M0 7H8 M0 8H8" />
              <path d="M1 0V4 M1 5V9 M2 0V4 M2 5V9 M3 0V4 M3 5V9 M4 0V4 M4 5V9 M5 0V4 M5 5V9 M6 0V4 M6 5V9 M7 0V4 M7 5V9" />
              <path d="M3 0L5 2 M5 0L3 2 M3 7L5 9 M5 7L3 9" />
            </svg>
            <div className="river">
              <span>{boardFlipped ? "漢 界" : "楚 河"}</span>
              <span>{boardFlipped ? "楚 河" : "漢 界"}</span>
            </div>
            {!previewingBoard && showBestArrows && engineState === "ready" && (
              <CandidateArrows
                candidates={candidates}
                pieces={pieces}
                flipped={boardFlipped}
              />
            )}
            {Array.from({ length: 10 }).map((_, y) =>
              Array.from({ length: 9 }).map((__, x) => {
                const rank = previewingBoard
                  ? -1
                  : pieceOptions.findIndex(
                      (c) => c.to?.[0] === x && c.to?.[1] === y,
                    );
                return (
                  <button
                    key={`${x}-${y}`}
                    disabled={previewingBoard}
                    aria-label={`棋盘 ${x},${y}`}
                    className={`point ${rank === 0 ? "best-point" : rank > 0 ? "good-point" : !previewingBoard && selectedPiece && isLegal(selectedPiece, x, y, pieces) ? "legal" : ""}`}
                    style={{
                      left: `${(boardFlipped ? 8 - x : x) * 12.5}%`,
                      top: `${(boardFlipped ? 9 - y : y) * 11.111}%`,
                    }}
                    onClick={() => clickPoint(x, y)}
                  />
                );
              }),
            )}
            {displayPieces.map((p) => {
              const targetRank =
                !previewingBoard &&
                selectedPiece &&
                p.side !== selectedPiece.side
                  ? pieceOptions.findIndex(
                      (c) => c.to?.[0] === p.x && c.to?.[1] === p.y,
                    )
                  : -1;
              return (
                <button
                  key={p.id}
                  disabled={previewingBoard}
                  aria-label={`${p.side === "red" ? "红" : "黑"}${p.name}${targetRank === 0 ? "，最佳吃子落点" : targetRank > 0 ? "，可吃落点" : ""}`}
                  onClick={() => clickPoint(p.x, p.y)}
                  className={`piece ${p.side} ${!previewingBoard && selected === p.id ? "selected" : ""} ${targetRank === 0 ? "best-target" : targetRank > 0 ? "good-target" : ""}`}
                  style={{
                    left: `${(boardFlipped ? 8 - p.x : p.x) * 12.5}%`,
                    top: `${(boardFlipped ? 9 - p.y : p.y) * 11.111}%`,
                  }}
                >
                  {p.name}
                </button>
              );
            })}
            {variationFrame?.from && variationFrame.to && (
              <svg
                key={`trail-${variationPreview?.index}`}
                className="variation-trail"
                viewBox="0 0 8 9"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <line
                  pathLength={1}
                  x1={boardFlipped ? 8 - variationFrame.from[0] : variationFrame.from[0]}
                  y1={boardFlipped ? 9 - variationFrame.from[1] : variationFrame.from[1]}
                  x2={boardFlipped ? 8 - variationFrame.to[0] : variationFrame.to[0]}
                  y2={boardFlipped ? 9 - variationFrame.to[1] : variationFrame.to[1]}
                />
              </svg>
            )}
            {variationFrame?.to && (
              <span
                className="variation-target"
                style={{
                  left: `${(boardFlipped ? 8 - variationFrame.to[0] : variationFrame.to[0]) * 12.5}%`,
                  top: `${(boardFlipped ? 9 - variationFrame.to[1] : variationFrame.to[1]) * 11.111}%`,
                }}
              />
            )}
            {variationFrame?.capturedPiece && variationFrame.to && (
              <span
                key={`captured-${variationPreview?.index}`}
                className={`piece ${variationFrame.capturedPiece.side} variation-captured-piece`}
                style={{
                  left: `${(boardFlipped ? 8 - variationFrame.to[0] : variationFrame.to[0]) * 12.5}%`,
                  top: `${(boardFlipped ? 9 - variationFrame.to[1] : variationFrame.to[1]) * 11.111}%`,
                }}
                aria-hidden="true"
              >
                {variationFrame.capturedPiece.name}
              </span>
            )}
            {variationFrame?.movingPiece && variationFrame.from && variationFrame.to && (
              <span
                key={`moving-${variationPreview?.index}`}
                className={`piece ${variationFrame.movingPiece.side} variation-moving-piece`}
                style={
                  {
                    "--from-left": `${(boardFlipped ? 8 - variationFrame.from[0] : variationFrame.from[0]) * 12.5}%`,
                    "--from-top": `${(boardFlipped ? 9 - variationFrame.from[1] : variationFrame.from[1]) * 11.111}%`,
                    "--to-left": `${(boardFlipped ? 8 - variationFrame.to[0] : variationFrame.to[0]) * 12.5}%`,
                    "--to-top": `${(boardFlipped ? 9 - variationFrame.to[1] : variationFrame.to[1]) * 11.111}%`,
                  } as CSSProperties
                }
                aria-label={`${variationFrame.step} ${variationFrame.notation}`}
              >
                {variationFrame.movingPiece.name}
              </span>
            )}
            {variationPreview && (
              <div className="variation-playback">
                <span>
                  ▶ 变化演示 {variationPreview.index}/
                  {variationPreview.frames.length - 1}
                </span>
                <i>{variationFrame?.step}</i>
                <strong>{variationFrame?.notation}</strong>
                <button onClick={() => setVariationPreview(null)}>退出</button>
              </div>
            )}
            {!variationPreview && timelinePreviewPly != null && (
              <div className="variation-playback timeline">
                <span>↔ 滑移预览</span>
                <strong>
                  {timelinePreviewPly === 0
                    ? "开局"
                    : `第 ${timelinePreviewPly} 步后`}
                </strong>
              </div>
            )}
          </div>
          <div
            className={`board-coordinates bottom-coordinates ${boardFlipped ? "black-coordinates" : "red-coordinates"}`}
            aria-label={boardFlipped ? "黑方路数" : "红方路数"}
          >
            {(boardFlipped
              ? ["9", "8", "7", "6", "5", "4", "3", "2", "1"]
              : ["九", "八", "七", "六", "五", "四", "三", "二", "一"]
            ).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="board-hint">
            <span>●</span>
            {gameMode === "setup"
              ? setupBrush === "move"
                ? "摆盘：点击棋子后，再点击目标位置"
                : setupBrush === "erase"
                  ? "摆盘：点击棋子即可删除"
                  : `摆盘：点击棋盘放置${setupBrush.side === "red" ? "红" : "黑"}${setupBrush.name}`
              : gameMode === "computer" && turn !== humanSide
                ? "电脑正在计算并将自动走出首选着法"
                : variationPreview
                  ? "正在演示皮卡鱼主变化，动画结束后自动返回实战局面"
                  : timelinePreviewPly != null
                    ? "正在预览历史局面，松开局势图后跳转"
                    : selectedPiece
                      ? selectedEngineState === "thinking"
                        ? `已选中${selectedPiece.name}：蓝色为合法落点，正在计算绿色首选`
                        : `已选中${selectedPiece.name}：绿色为本子首选，蓝色为其他合法落点`
                      : activePly < history.length
                        ? `正在查看第 ${activePly} 步后的历史局面；现在落子将从此处分支，并替换主线后续 ${history.length - activePly} 步`
                        : engineState === "thinking"
                          ? `皮卡鱼思考中，仍可继续行棋；落子后自动改算${turn === "red" ? "黑" : "红"}方应着`
                          : `${turn === "red" ? "红" : "黑"}方走棋 · 点击棋子开始`}
          </div>
          {engineDownload && (
            <div className="engine-download" role="status" aria-live="polite">
              <div>
                <strong>
                  正在准备本地皮卡鱼 {Math.min(100, Math.round((engineDownload.loaded / engineDownload.total) * 100))}%
                </strong>
                <span>
                  {(engineDownload.loaded / 1024 / 1024).toFixed(1)} / {(engineDownload.total / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <progress value={engineDownload.loaded} max={engineDownload.total} />
              <small>首次使用需要下载棋力网络；下载期间棋盘仍可正常行棋。</small>
            </div>
          )}
        </div>

        <div className="coach-sidebar">
        <Collapsible title="教练分析" open><aside className="right-panel panel">
          <div className="panel-title">
            <span>01</span>
            <div>
              <strong>教练分析</strong>
              <small>COACH REVIEW</small>
            </div>
          </div>
          <div className="coach-card">
            <span className="stamp">
              {selectedPiece ? "建议" : analysis.grade}
            </span>
            <div>
              <strong className={!selectedPiece && lastMove ? `move-${lastMove.piece.side}` : undefined}>
                {selectedPiece
                  ? `${selectedPiece.name}怎么走`
                  : lastMove
                    ? moveName(lastMove)
                    : "等待落子"}
              </strong>
              <small>
                {selectedPiece
                  ? selectedEngineState === "ready"
                    ? `皮卡鱼已评价 ${pieceOptions.length} 个合法落点`
                    : "正在逐着计算走后评分"
                  : analysis.summary}
              </small>
            </div>
            <b>
              {selectedPiece
                ? selectedEngineState === "ready"
                  ? selectedIsGlobalBest
                    ? "全局最优"
                    : "本子首选"
                  : "分析中"
                : engineState === "ready"
                  ? currentPositionScore
                  : engineState === "error"
                    ? "未评分"
                    : "计算中"}
            </b>
          </div>
          <p className="coach-copy">
            {selectedPiece
              ? selectedEngineState === "ready"
                ? selectedIsGlobalBest
                  ? `这枚${selectedPiece.name}的首选 ${pieceOptions[0]?.move ?? ""} 与全局第一候选评分相同，属于全局最优着法。`
                  : `这枚${selectedPiece.name}内部首选是 ${pieceOptions[0]?.move ?? "无合法着法"}。绿色表示该棋子的皮卡鱼首选落点；当前评分低于全局首选。`
                : selectedEngineState === "error"
                  ? "皮卡鱼限定搜索超时或当前模式不支持，已停止推荐，不会使用启发式分数代替。"
                  : `皮卡鱼正在以深度 ${analysisDepth} 分析这枚棋子的全部合法着法。`
              : analysis.detail}
          </p>
          <div className="global-best-summary">
            <span>全局最优着法 · 单击动画演示</span>
            {candidates[0] ? (
              <div
                onClick={() => scheduleCandidatePreview(candidates[0])}
                onDoubleClick={() => playCandidate(candidates[0])}
                title={`单击演示变化 · 双击走 ${candidates[0].move}`}
              >
                <strong className={`move-${turn}`}>{candidates[0].move}</strong>
                <em>
                  走后评分 {candidates[0].score} · 深度{" "}
                  {engineLines[0]?.depth ?? analysisDepth}
                </em>
                <b>最佳</b>
              </div>
            ) : (
              <p>
                {engineState === "error"
                  ? "本次计算超时，暂无可靠结论。"
                  : `深度 ${analysisDepth} 计算中，棋盘仍可操作。`}
              </p>
            )}
          </div>
          {selectedPiece &&
            selectedEngineState === "ready" &&
            !selectedIsGlobalBest && (
              <div className="global-advice">
                <span>全局更优</span>
                <strong>这枚棋子的首选并非全局最佳</strong>
                <p>皮卡鱼建议优先考虑：</p>
                <div>
                  {globalAlternatives.map((c, i) => (
                    <em key={`${c.move}-${i}`}>
                      {i + 1}. {c.move}（{c.score}）
                    </em>
                  ))}
                </div>
              </div>
            )}
          {!selectedPiece && engineState === "error" && (
            <div className="engine-warning">
              <strong>皮卡鱼计算超时</strong>
              <p>当前局面没有可靠评分，因此不显示候选着法。</p>
            </div>
          )}
          <label>
            {selectedPiece
              ? `这枚${selectedPiece.name}的走法 · 深度 ${analysisDepth}`
              : `皮卡鱼候选 · ${turn === "red" ? "红方" : "黑方"} · 深度 ${analysisDepth}`}{" "}
            {((!selectedPiece && engineState === "thinking") ||
              (selectedPiece && selectedEngineState === "thinking")) &&
              "· 计算中…"}{" "}
            · 单击演示 · 双击落子
          </label>
          <div
            className={`candidate-list ${(!selectedPiece && engineState === "thinking") || (selectedPiece && selectedEngineState === "thinking") ? "analyzing" : ""}`}
          >
            {shownCandidates.map((c, i) => (
              <div
                className={`candidate move-${turn} ${previewedCandidateMove ? (c.uciMoves[0] === previewedCandidateMove ? "previewing" : "") : c.tone}`}
                key={`${c.move}-${i}`}
                onClick={() => scheduleCandidatePreview(c)}
                onDoubleClick={() => playCandidate(c)}
                title={`单击动画演示 · 双击走 ${c.move}`}
              >
                <i>{i + 1}</i>
                <strong>{c.move}</strong>
                <span>{c.tag}</span>
                <b>走后 {c.score}</b>
              </div>
            ))}
          </div>
          {!shownCandidates.length &&
            ((!selectedPiece && engineState === "thinking") ||
              (selectedPiece && selectedEngineState === "thinking")) && (
              <div className="candidate-progress">
                深度 {analysisDepth} 计算中…（棋盘仍可操作）
              </div>
            )}
          <div className="principle">
            <span>本步原则</span>
            <strong>{analysis.principle}</strong>
            <p>请结合对手下一步最强回应，再决定后续计划。</p>
          </div>
        </aside></Collapsible>

      <Collapsible title="局势图"><SituationChart
        points={evaluationPoints}
        history={history}
        analyzing={engineState === "loading" || engineState === "thinking"}
        activePly={activePly}
        flipped={boardFlipped}
        onPreviewPly={previewTimeline}
        onSelectPly={goToPly}
        startingPieces={startingPieces}
      /></Collapsible>

      <Collapsible title="对弈与分析设置"><section className="game-mode-card panel" aria-label="对弈与分析设置">
        <div className="game-mode-bar">
          {(["local", "computer", "setup"] as GameMode[]).map((mode) => (
            <button key={mode} className={gameMode === mode ? "active" : ""} onClick={() => changeGameMode(mode)}>
              {mode === "local" ? "双人对弈" : mode === "computer" ? "人机对战" : "摆盘"}
            </button>
          ))}
        </div>
        {gameMode === "computer" && <div className="computer-options">
          <button className="side-choice" onClick={() => { setHumanSide((side) => side === "red" ? "black" : "red"); aiPositionRef.current = ""; }}>我执{humanSide === "red" ? "红" : "黑"}</button>
          <label className="level-choice"><span>电脑等级</span><select value={computerElo} onChange={(event) => { setComputerElo(Number(event.target.value)); aiPositionRef.current = ""; }}>{[["业余一级",1320],["业余三级",1500],["业余五级",1700],["业余七级",1900],["业余九级",2100],["专业一级",2300],["专业三级",2500],["专业五级",2700],["专业七级",2900],["专业九级",3100]].map(([name, elo]) => <option key={elo} value={elo}>{name} · Elo {elo}</option>)}</select></label>
        </div>}
        <div className="depth-setting">
          <div><strong>分析深度</strong><small>修改后从当前局面重新计算</small></div>
          <div className="depth-options">{DEPTH_OPTIONS.map((depth) => <button key={depth} className={depth === analysisDepth ? "active" : ""} onClick={() => changeDepth(depth)} aria-pressed={depth === analysisDepth}>{depth}</button>)}</div>
        </div>
        {gameMode === "setup" && <div className="setup-panel">
          <div className="setup-actions"><button className={setupBrush === "move" ? "active" : ""} onClick={() => setSetupBrush("move")}>移动</button><button className={setupBrush === "erase" ? "active" : ""} onClick={() => setSetupBrush("erase")}>删除</button><button onClick={() => setTurn((side) => side === "red" ? "black" : "red")}>{turn === "red" ? "红方先行" : "黑方先行"}</button><button className="finish" onClick={finishSetup}>完成摆盘</button></div>
          {(["red", "black"] as Side[]).map((side) => <div className={`setup-pieces ${side}`} key={side}><span>{side === "red" ? "红方" : "黑方"}</span>{setupPieces[side].map((name) => { const active=typeof setupBrush === "object" && setupBrush.side === side && setupBrush.name === name; return <button key={name} className={active ? "active" : ""} onClick={() => setSetupBrush({side,name})}>{name}</button>; })}</div>)}
          {setupMessage && <p>{setupMessage}</p>}
        </div>}
      </section></Collapsible>

      <Collapsible title="棋谱与存档"><section className="record-toolbar panel" aria-label="棋谱与存档">
        <div className="record-summary"><span aria-hidden="true">谱</span><div><small>当前棋局</small><strong>{recordTitle}</strong></div><em>{history.length ? `${activePly} / ${history.length} 步` : "标准新局"}</em></div>
        <div className="record-stepper" aria-label="棋谱步进">
          <button onClick={() => goToPly(0)} disabled={activePly === 0} title="回到开始"><i>⇤</i><span>开始</span></button><button onClick={() => goToPly(activePly - 1)} disabled={activePly === 0} title="上一步"><i>‹</i><span>上一步</span></button><button onClick={() => goToPly(activePly + 1)} disabled={activePly === history.length} title="下一步"><span>下一步</span><i>›</i></button><button onClick={() => goToPly(history.length)} disabled={activePly === history.length} title="前往末尾"><span>末尾</span><i>⇥</i></button>
        </div>
        <div className="record-actions"><button className="load-record" onClick={() => { refreshSavedGames(); setShowRecordPanel((value) => !value); }}><i>↥</i> 载入棋谱</button><button className="save-record" onClick={saveGame}><i>⌑</i> 保存棋局</button></div>
        <input ref={recordFileRef} type="file" hidden accept=".xqf,.fen,.json,text/plain,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRecordFile(file); }} />
        {showRecordPanel && <section className="record-loader panel">
          <div className="loader-heading"><div><strong>载入棋谱或局面</strong><small>文件只在本机浏览器中读取，不会上传</small></div><button onClick={() => setShowRecordPanel(false)} aria-label="关闭载入面板">×</button></div>
          <div className="loader-grid"><button className="file-load" onClick={() => recordFileRef.current?.click()}><b>选择本地文件</b><span>XQF 1.0 · FEN · 弈思 JSON 存档</span></button><div className="fen-load"><label htmlFor="fen-input">粘贴 FEN 局面</label><textarea id="fen-input" value={fenInput} onChange={(event) => setFenInput(event.target.value)} placeholder="例如：rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w" /><button onClick={importFenText} disabled={!fenInput.trim()}>载入此局面</button></div></div>
          <div className="saved-games"><strong>本机存档</strong>{savedGames.length ? savedGames.map((saved) => <button key={saved.id} onClick={() => loadSavedGame(saved.id)}><span>{saved.title}</span><small>{new Date(saved.savedAt).toLocaleString("zh-CN")}</small></button>) : <em>还没有保存的棋局</em>}</div>
        </section>}
      </section></Collapsible>
        </div>
      </section>

      <footer>
        <div>
          <b>{Math.floor(activePly / 2)}</b>
          <span>已走回合</span>
        </div>
        <div>
          <b>{activePly ? analysis.grade : "—"}</b>
          <span>本步质量</span>
        </div>
        <div className="moves">
          <span>走法记录</span>
          {history.length ? (
            <>
              <button
                className={activePly === 0 ? "current" : "past"}
                onClick={() => goToPly(0)}
              >
                开局
              </button>
              {history.map((m, i) => (
                <button
                  key={i}
                  className={`move-${m.piece.side} ${
                    activePly === i + 1
                      ? "current"
                      : activePly < i + 1
                        ? "future"
                        : "past"
                  }`}
                  onClick={() => goToPly(i + 1)}
                >
                  {Math.floor(i / 2) + 1}
                  {m.piece.side === "red" ? "." : "…"} {moveName(m)}
                </button>
              ))}
            </>
          ) : (
            <em>落子后将在这里生成复盘轨迹</em>
          )}
          <small className="round-rule">双方各走一步计 1 回合</small>
        </div>
        <a className="engine-credit" href="/pikafish/SOURCE.md" target="_blank">
          Pikafish · GPL-3.0
        </a>
      </footer>
      {outcome && outcomeOpen && (
        <div className="result-backdrop">
          <section className="result-modal" role="alertdialog" aria-modal="true" aria-labelledby="result-title">
            <div className="result-mark">胜</div>
            <h2 id="result-title">{outcome.title}</h2>
            <p>{outcome.detail}</p>
            <div><button className="primary" onClick={reset}>再来一局</button><button onClick={() => setOutcomeOpen(false)}>查看棋局</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
