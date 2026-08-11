package com.yisi.xiangqicoach;

import java.util.ArrayList;
import java.util.List;

/** UI-side Xiangqi rules. Human moves never wait for Pikafish. */
final class XiangqiRules {
    private XiangqiRules() {}

    static List<String> legalMoves(BoardPiece piece, List<BoardPiece> pieces) {
        List<String> result = new ArrayList<>();
        for (int rank = 0; rank < 10; rank++) for (int file = 0; file < 9; file++) {
            if (isLegal(piece, file, rank, pieces)) result.add(piece.square() + square(file, rank));
        }
        return result;
    }

    static List<String> legalMoves(Side side, List<BoardPiece> pieces) {
        List<String> result = new ArrayList<>();
        for (BoardPiece piece : pieces) if (piece.side == side) result.addAll(legalMoves(piece, pieces));
        return result;
    }

    static boolean isLegal(BoardPiece piece, int file, int rank, List<BoardPiece> pieces) {
        if (!isPseudoLegal(piece, file, rank, pieces)) return false;
        List<BoardPiece> next = new ArrayList<>();
        for (BoardPiece candidate : pieces) {
            boolean moving = candidate.file == piece.file && candidate.rank == piece.rank;
            boolean captured = candidate.file == file && candidate.rank == rank;
            if (!moving && !captured) next.add(candidate);
        }
        next.add(new BoardPiece(piece.side, piece.kind, file, rank));
        return !isInCheck(piece.side, next);
    }

    private static boolean isPseudoLegal(BoardPiece piece, int file, int rank, List<BoardPiece> pieces) {
        if (file < 0 || file > 8 || rank < 0 || rank > 9 || (file == piece.file && rank == piece.rank)) return false;
        BoardPiece target = at(pieces, file, rank);
        if (target != null && target.side == piece.side) return false;
        int dx = Math.abs(file - piece.file), dy = Math.abs(rank - piece.rank), between = 0;
        for (BoardPiece candidate : pieces) {
            if (candidate.file == piece.file && file == piece.file && candidate.rank > Math.min(rank, piece.rank) && candidate.rank < Math.max(rank, piece.rank)) between++;
            else if (candidate.rank == piece.rank && rank == piece.rank && candidate.file > Math.min(file, piece.file) && candidate.file < Math.max(file, piece.file)) between++;
        }
        switch (piece.kind) {
            case ROOK: return (dx == 0 || dy == 0) && between == 0;
            case CANNON: return (dx == 0 || dy == 0) && between == (target == null ? 0 : 1);
            case HORSE:
                if (dx * dy != 2) return false;
                int legFile = dx == 2 ? piece.file + (file - piece.file) / 2 : piece.file;
                int legRank = dy == 2 ? piece.rank + (rank - piece.rank) / 2 : piece.rank;
                return at(pieces, legFile, legRank) == null;
            case ELEPHANT:
                return dx == 2 && dy == 2 && (piece.side == Side.RED ? rank >= 5 : rank <= 4)
                        && at(pieces, (file + piece.file) / 2, (rank + piece.rank) / 2) == null;
            case ADVISOR:
                return dx == 1 && dy == 1 && file >= 3 && file <= 5
                        && (piece.side == Side.RED ? rank >= 7 : rank <= 2);
            case KING:
                boolean flying = file == piece.file && target != null && target.kind == PieceKind.KING && between == 0;
                return flying || (dx + dy == 1 && file >= 3 && file <= 5
                        && (piece.side == Side.RED ? rank >= 7 : rank <= 2));
            case PAWN:
                int step = piece.side == Side.RED ? -1 : 1;
                boolean crossed = piece.side == Side.RED ? piece.rank <= 4 : piece.rank >= 5;
                return (file == piece.file && rank - piece.rank == step) || (crossed && rank == piece.rank && dx == 1);
            default: return false;
        }
    }

    private static boolean isInCheck(Side side, List<BoardPiece> pieces) {
        BoardPiece king = null;
        for (BoardPiece piece : pieces) if (piece.side == side && piece.kind == PieceKind.KING) { king = piece; break; }
        if (king == null) return true;
        for (BoardPiece piece : pieces) if (piece.side != side && isPseudoLegal(piece, king.file, king.rank, pieces)) return true;
        return false;
    }

    private static BoardPiece at(List<BoardPiece> pieces, int file, int rank) {
        for (BoardPiece piece : pieces) if (piece.file == file && piece.rank == rank) return piece;
        return null;
    }

    private static String square(int file, int rank) { return "" + (char) ('a' + file) + (9 - rank); }
}
