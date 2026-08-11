export type RecordSide = "red" | "black";
export type RecordPiece = {
  id: string;
  side: RecordSide;
  name: string;
  x: number;
  y: number;
};
export type RecordMove = { from: [number, number]; to: [number, number] };

export type ImportedRecord = {
  title: string;
  pieces: RecordPiece[];
  turn: RecordSide;
  moves: RecordMove[];
  source: "fen" | "xqf" | "yisi";
};

const fenNames: Record<string, [RecordSide, string]> = {
  R: ["red", "车"], N: ["red", "马"], B: ["red", "相"],
  E: ["red", "相"], A: ["red", "仕"], K: ["red", "帅"],
  C: ["red", "炮"], P: ["red", "兵"], r: ["black", "车"],
  n: ["black", "马"], b: ["black", "象"], e: ["black", "象"],
  a: ["black", "士"], k: ["black", "将"], c: ["black", "炮"],
  p: ["black", "卒"],
};

export function parseFen(input: string): ImportedRecord {
  const fields = input.trim().replace(/^fen\s+/i, "").split(/\s+/);
  const ranks = fields[0]?.split("/");
  if (ranks?.length !== 10) throw new Error("FEN 必须包含 10 行棋盘。 ");
  const pieces: RecordPiece[] = [];
  ranks.forEach((rank, y) => {
    let x = 0;
    for (const token of rank) {
      if (/\d/.test(token)) x += Number(token);
      else {
        const definition = fenNames[token];
        if (!definition) throw new Error(`FEN 中包含未知棋子“${token}”。`);
        if (x > 8) throw new Error("FEN 某一行超过 9 路。 ");
        pieces.push({ id: `fen-${y}-${x}`, side: definition[0], name: definition[1], x, y });
        x++;
      }
    }
    if (x !== 9) throw new Error(`FEN 第 ${y + 1} 行不是 9 路。`);
  });
  if (!pieces.some((piece) => piece.name === "帅") || !pieces.some((piece) => piece.name === "将"))
    throw new Error("FEN 必须同时包含红帅和黑将。 ");
  const turn = fields[1]?.toLowerCase() === "b" ? "black" : "red";
  return { title: "FEN 局面", pieces, turn, moves: [], source: "fen" };
}

// XQF 1.0 stores a 1 KiB header followed by four-byte move nodes.  Versions
// after 10 encrypt both header coordinates and the move stream and therefore
// need a different decoder; rejecting those explicitly avoids silently loading
// a corrupt position.
const xqfPieceOrder: Array<[RecordSide, string]> = [
  ["red", "车"], ["red", "马"], ["red", "相"], ["red", "仕"],
  ["red", "帅"], ["red", "仕"], ["red", "相"], ["red", "马"],
  ["red", "车"], ["red", "炮"], ["red", "炮"], ...Array(5).fill(["red", "兵"]),
  ["black", "车"], ["black", "马"], ["black", "象"], ["black", "士"],
  ["black", "将"], ["black", "士"], ["black", "象"], ["black", "马"],
  ["black", "车"], ["black", "炮"], ["black", "炮"], ...Array(5).fill(["black", "卒"]),
] as Array<[RecordSide, string]>;

export function parseXqf(buffer: ArrayBuffer, fileName = "XQF 棋谱"): ImportedRecord {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 1028 || bytes[0] !== 0x58 || bytes[1] !== 0x51)
    throw new Error("不是有效的 XQF 棋谱文件。 ");
  const version = bytes[2];
  if (version > 10)
    throw new Error(`此文件为加密 XQF v${version}；HTML 离线版当前支持 XQF 1.0（v10 及以下）。`);
  const pieces: RecordPiece[] = [];
  for (let index = 0; index < 32; index++) {
    const square = bytes[16 + index];
    if (square >= 90) continue;
    const [side, name] = xqfPieceOrder[index];
    pieces.push({ id: `xqf-${index}`, side, name, x: Math.floor(square / 10), y: 9 - (square % 10) });
  }
  if (!pieces.some((piece) => piece.name === "帅") || !pieces.some((piece) => piece.name === "将"))
    throw new Error("XQF 初始局面缺少将帅。 ");
  const moves: RecordMove[] = [];
  let offset = 1024;
  // Follow the main line. In v10 bit 4 marks a child and bit 5 a sibling.
  while (offset + 3 < bytes.length) {
    const from = bytes[offset] - 24;
    const to = bytes[offset + 1] - 32;
    const flags = bytes[offset + 2];
    offset += 4;
    if (from >= 0 && from < 90 && to >= 0 && to < 90) {
      moves.push({
        from: [Math.floor(from / 10), 9 - (from % 10)],
        to: [Math.floor(to / 10), 9 - (to % 10)],
      });
    }
    if (!(flags & 0x10)) break;
  }
  return { title: fileName.replace(/\.xqf$/i, ""), pieces, turn: "red", moves, source: "xqf" };
}

export const SAVED_GAME_VERSION = 1;
