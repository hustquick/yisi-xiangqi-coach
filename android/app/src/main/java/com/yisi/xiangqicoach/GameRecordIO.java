package com.yisi.xiangqicoach;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class GameRecordIO {
    static final class Record {
        final String title, startFen; final List<String> moves; final int activePly;
        Record(String title, String startFen, List<String> moves, int activePly) {
            this.title = title; this.startFen = startFen; this.moves = moves; this.activePly = activePly;
        }
    }

    static Record parseFen(byte[] data, String title) throws Exception {
        String fen = new String(data, StandardCharsets.UTF_8).trim().replaceFirst("(?i)^fen\\s+", "");
        if (fen.split("\\s+")[0].split("/").length != 10) throw new Exception("FEN 必须包含 10 行棋盘。");
        ParsedPosition parsed = ParsedPosition.parse(fen); boolean red = false, black = false;
        for (BoardPiece piece : parsed.pieces) if (piece.kind == PieceKind.KING) { if (piece.side == Side.RED) red = true; else black = true; }
        if (!red || !black) throw new Exception("FEN 必须同时包含红帅和黑将。");
        return new Record(title, fen, new ArrayList<>(), 0);
    }

    static Record parseXqf(byte[] b, String title) throws Exception {
        if (b.length < 1028 || b[0] != 0x58 || b[1] != 0x51) throw new Exception("不是有效的 XQF 棋谱文件。");
        if ((b[2] & 255) > 10) throw new Exception("当前离线版支持 XQF 1.0（v10 及以下）。");
        String order = "RNBAKABNRCCPPPPP" + "rnbakabnrccppppp";
        char[] board = new char[90]; java.util.Arrays.fill(board, '1');
        for (int i = 0; i < 32; i++) { int sq = b[16 + i] & 255; if (sq < 90) board[(9 - sq % 10) * 9 + sq / 10] = order.charAt(i); }
        StringBuilder fen = new StringBuilder();
        for (int rank = 0; rank < 10; rank++) { if (rank > 0) fen.append('/'); int empty = 0;
            for (int file = 0; file < 9; file++) { char value = board[rank * 9 + file]; if (value == '1') empty++; else { if (empty > 0) { fen.append(empty); empty = 0; } fen.append(value); } }
            if (empty > 0) fen.append(empty);
        }
        List<String> moves = new ArrayList<>(); int offset = 1024;
        while (offset + 3 < b.length) { int from = (b[offset] & 255) - 24, to = (b[offset + 1] & 255) - 32, flags = b[offset + 2] & 255; offset += 4;
            if (from >= 0 && from < 90 && to >= 0 && to < 90) moves.add("" + (char)('a' + from / 10) + from % 10 + (char)('a' + to / 10) + to % 10);
            if ((flags & 0x10) == 0) break;
        }
        return new Record(title, fen + " w - - 0 1", moves, moves.size());
    }

    static JSONObject toJson(Record record) throws Exception {
        JSONObject json = new JSONObject(); json.put("title", record.title); json.put("startFen", record.startFen); json.put("activePly", record.activePly);
        json.put("moves", new JSONArray(record.moves)); json.put("savedAt", System.currentTimeMillis()); return json;
    }

    static Record fromJson(JSONObject json) throws Exception {
        JSONArray array = json.getJSONArray("moves"); List<String> moves = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) moves.add(array.getString(i));
        return new Record(json.optString("title", "导入棋局"), json.getString("startFen"), moves, json.optInt("activePly", moves.size()));
    }
}
