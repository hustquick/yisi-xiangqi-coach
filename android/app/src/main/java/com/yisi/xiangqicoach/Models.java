package com.yisi.xiangqicoach;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

enum Side {
    RED, BLACK;

    String title() { return this == RED ? "红方" : "黑方"; }
}

enum GameMode { LOCAL, COMPUTER, SETUP }
enum SetupAction { MOVE, ERASE, PIECE }

enum PieceKind { ROOK, HORSE, ELEPHANT, ADVISOR, KING, CANNON, PAWN }

final class BoardPiece {
    final Side side;
    final PieceKind kind;
    final int file;
    final int rank;

    BoardPiece(Side side, PieceKind kind, int file, int rank) {
        this.side = side;
        this.kind = kind;
        this.file = file;
        this.rank = rank;
    }

    String name() {
        switch (kind) {
            case ROOK: return "车";
            case HORSE: return "马";
            case ELEPHANT: return side == Side.RED ? "相" : "象";
            case ADVISOR: return side == Side.RED ? "仕" : "士";
            case KING: return side == Side.RED ? "帅" : "将";
            case CANNON: return "炮";
            case PAWN: return side == Side.RED ? "兵" : "卒";
            default: return "?";
        }
    }

    String square() { return "" + (char) ('a' + file) + (9 - rank); }
}

final class ParsedPosition {
    final List<BoardPiece> pieces;
    final Side sideToMove;

    ParsedPosition(List<BoardPiece> pieces, Side sideToMove) {
        this.pieces = Collections.unmodifiableList(pieces);
        this.sideToMove = sideToMove;
    }

    static ParsedPosition parse(String fen) {
        String[] fields = fen.trim().split("\\s+");
        String[] rows = fields[0].split("/");
        List<BoardPiece> pieces = new ArrayList<>();
        for (int rank = 0; rank < Math.min(10, rows.length); rank++) {
            int file = 0;
            for (int index = 0; index < rows[rank].length(); index++) {
                char symbol = rows[rank].charAt(index);
                if (Character.isDigit(symbol)) {
                    file += symbol - '0';
                    continue;
                }
                PieceKind kind = kindFor(symbol);
                if (kind != null && file < 9) {
                    pieces.add(new BoardPiece(Character.isUpperCase(symbol) ? Side.RED : Side.BLACK,
                            kind, file, rank));
                    file++;
                }
            }
        }
        Side side = fields.length > 1 && "b".equals(fields[1]) ? Side.BLACK : Side.RED;
        return new ParsedPosition(pieces, side);
    }

    private static PieceKind kindFor(char value) {
        switch (Character.toLowerCase(value)) {
            case 'r': return PieceKind.ROOK;
            case 'n': case 'h': return PieceKind.HORSE;
            case 'b': case 'e': return PieceKind.ELEPHANT;
            case 'a': return PieceKind.ADVISOR;
            case 'k': return PieceKind.KING;
            case 'c': return PieceKind.CANNON;
            case 'p': return PieceKind.PAWN;
            default: return null;
        }
    }
}

final class EngineLine {
    final int depth;
    final int selDepth;
    final int multipv;
    final String score;
    final String pv;
    final long nodes;
    final long nps;

    EngineLine(JSONObject json) throws JSONException {
        depth = json.getInt("depth");
        selDepth = json.optInt("selDepth", depth);
        multipv = json.getInt("multipv");
        score = json.getString("score");
        pv = json.getString("pv");
        nodes = json.optLong("nodes", 0);
        nps = json.optLong("nps", 0);
    }

    String firstMove() {
        String value = pv.trim();
        int separator = value.indexOf(' ');
        return separator < 0 ? value : value.substring(0, separator);
    }

    Integer centipawns() {
        String[] fields = score.split(" ");
        if (fields.length < 2 || !"cp".equals(fields[0])) return null;
        try { return Integer.parseInt(fields[1]); }
        catch (NumberFormatException ignored) { return null; }
    }

    String displayScore(Side sideToMove) {
        String[] fields = score.split(" ");
        if (fields.length < 2) return "—";
        try {
            int value = Integer.parseInt(fields[1]);
            int redValue = sideToMove == Side.RED ? value : -value;
            if ("mate".equals(fields[0])) return (redValue >= 0 ? "红方" : "黑方") + "杀" + Math.abs(redValue);
            return String.format(Locale.CHINA, "%+.2f", redValue / 100.0);
        } catch (NumberFormatException ignored) {
            return "—";
        }
    }
}

final class MoveRecord {
    final String beforeFen;
    final String uci;
    final String notation;
    final Side mover;
    final Integer beforeScore;
    final boolean wasEngineBest;
    final String bestBefore;

    MoveRecord(String beforeFen, String uci, String notation, Side mover, Integer beforeScore, boolean wasEngineBest, String bestBefore) {
        this.beforeFen = beforeFen;
        this.uci = uci;
        this.notation = notation;
        this.mover = mover;
        this.beforeScore = beforeScore;
        this.wasEngineBest = wasEngineBest;
        this.bestBefore = bestBefore;
    }
}

final class EvaluationPoint {
    final int ply;
    final Integer score;

    EvaluationPoint(int ply, Integer score) {
        this.ply = ply;
        this.score = score;
    }
}

final class MoveCoordinates {
    final int fromFile, fromRank, toFile, toRank;

    MoveCoordinates(int fromFile, int fromRank, int toFile, int toRank) {
        this.fromFile = fromFile;
        this.fromRank = fromRank;
        this.toFile = toFile;
        this.toRank = toRank;
    }
}

final class ChineseNotation {
    private static final String[] RED_FILES = {"九", "八", "七", "六", "五", "四", "三", "二", "一"};
    private static final String[] NUMERALS = {"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"};

    private ChineseNotation() {}

    static String name(String uci, List<BoardPiece> pieces) {
        MoveCoordinates points = coordinates(uci);
        if (points == null) return uci;
        BoardPiece piece = null;
        for (BoardPiece candidate : pieces) {
            if (candidate.file == points.fromFile && candidate.rank == points.fromRank) {
                piece = candidate;
                break;
            }
        }
        if (piece == null) return uci;

        boolean forward = piece.side == Side.RED
                ? points.toRank < points.fromRank
                : points.toRank > points.fromRank;
        boolean diagonal = piece.kind == PieceKind.HORSE
                || piece.kind == PieceKind.ELEPHANT
                || piece.kind == PieceKind.ADVISOR;
        String startFile = fileName(points.fromFile, piece.side);
        String endFile = fileName(points.toFile, piece.side);

        List<BoardPiece> sameFile = new ArrayList<>();
        for (BoardPiece candidate : pieces) {
            if (candidate.side == piece.side && candidate.kind == piece.kind && candidate.file == piece.file) {
                sameFile.add(candidate);
            }
        }
        String prefix;
        if (sameFile.size() == 2) {
            int frontRank = sameFile.get(0).rank;
            for (BoardPiece candidate : sameFile) {
                frontRank = piece.side == Side.RED
                        ? Math.min(frontRank, candidate.rank)
                        : Math.max(frontRank, candidate.rank);
            }
            prefix = (piece.rank == frontRank ? "前" : "后") + piece.name();
        } else {
            prefix = piece.name() + startFile;
        }

        if (diagonal) return prefix + (forward ? "进" : "退") + endFile;
        if (points.fromFile != points.toFile) return prefix + "平" + endFile;
        int distance = Math.abs(points.toRank - points.fromRank);
        String distanceText = piece.side == Side.RED ? NUMERALS[Math.min(distance, 9)] : String.valueOf(distance);
        return prefix + (forward ? "进" : "退") + distanceText;
    }

    static MoveCoordinates coordinates(String uci) {
        if (uci == null || uci.length() != 4) return null;
        int fromFile = uci.charAt(0) - 'a';
        int toFile = uci.charAt(2) - 'a';
        int fromUciRank = uci.charAt(1) - '0';
        int toUciRank = uci.charAt(3) - '0';
        if (fromFile < 0 || fromFile > 8 || toFile < 0 || toFile > 8
                || fromUciRank < 0 || fromUciRank > 9 || toUciRank < 0 || toUciRank > 9) return null;
        return new MoveCoordinates(fromFile, 9 - fromUciRank, toFile, 9 - toUciRank);
    }

    private static String fileName(int file, Side side) {
        return side == Side.RED ? RED_FILES[file] : String.valueOf(file + 1);
    }
}
