package com.yisi.xiangqicoach;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class CoachController {
    interface Listener { void onStateChanged(); }

    static final String INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
    static final List<Integer> AVAILABLE_DEPTHS = Collections.unmodifiableList(Arrays.asList(8, 10, 12, 14, 16));

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService engineQueue = Executors.newSingleThreadExecutor();
    private final ExecutorService interruptQueue = Executors.newSingleThreadExecutor();
    private Listener listener;
    private boolean initialized;
    private volatile int positionGeneration;
    private volatile int selectionGeneration;
    private volatile int backfillGeneration;

    String fen = INITIAL_FEN;
    List<String> legalMoves = new ArrayList<>();
    List<EngineLine> globalLines = new ArrayList<>();
    List<EngineLine> selectedLines = new ArrayList<>();
    final List<MoveRecord> history = new ArrayList<>();
    final Map<Integer, Integer> positionScores = new HashMap<>();
    boolean analyzing;
    boolean analyzingSelection;
    String errorMessage;
    String selectedSquare;
    String previewedCandidateMove;
    int analysisDepth = 12;
    boolean showBestArrows;
    boolean boardFlipped;
    int activePly;
    String timelineEndFen = INITIAL_FEN;
    GameMode gameMode = GameMode.LOCAL;
    Side humanSide = Side.RED;
    SetupAction setupAction = SetupAction.MOVE;
    Side setupSide = Side.RED;
    PieceKind setupKind = PieceKind.ROOK;
    String setupMessage;
    String recordTitle = "新对局";
    String recordMessage;
    private final Runnable computerMove = () -> {
        if (gameMode == GameMode.COMPUTER && sideToMove() != humanSide && !analyzing && !globalLines.isEmpty()) play(globalLines.get(0).firstMove());
    };

    CoachController(Context context) { this.context = context.getApplicationContext(); }

    void setListener(Listener listener) { this.listener = listener; }

    void start() { refreshAnalysis(); }

    ParsedPosition position() { return ParsedPosition.parse(fen); }

    List<BoardPiece> pieces() { return position().pieces; }

    List<BoardPiece> piecesAtPly(int ply) {
        int target = Math.max(0, Math.min(history.size(), ply));
        String targetFen = target < history.size() ? history.get(target).beforeFen : timelineEndFen;
        return ParsedPosition.parse(targetFen).pieces;
    }

    Side sideToMove() { return position().sideToMove; }

    BoardPiece selectedPiece() {
        if (selectedSquare == null) return null;
        for (BoardPiece piece : pieces()) if (piece.square().equals(selectedSquare)) return piece;
        return null;
    }

    List<String> selectedLegalMoves() {
        BoardPiece selected = selectedPiece();
        return selected == null ? Collections.emptyList() : XiangqiRules.legalMoves(selected, pieces());
    }

    String selectedBestMove() { return selectedLines.isEmpty() ? null : selectedLines.get(0).firstMove(); }

    String globalBestMove() { return globalLines.isEmpty() ? null : globalLines.get(0).firstMove(); }

    boolean selectedIsGlobalBest() {
        if (selectedLines.isEmpty() || globalLines.isEmpty()) return false;
        EngineLine selected = selectedLines.get(0);
        EngineLine global = globalLines.get(0);
        if (selected.firstMove().equals(global.firstMove())) return true;
        Integer selectedScore = selected.centipawns();
        Integer globalScore = global.centipawns();
        if (selectedScore != null && globalScore != null) return selectedScore.equals(globalScore);
        return selected.score.equals(global.score);
    }

    int completedRounds() { return activePly / 2; }

    MoveRecord activeMove() { return activePly > 0 ? history.get(activePly - 1) : null; }

    String currentScore() { return globalLines.isEmpty() ? "—" : scoreText(globalLines.get(0)); }

    String scoreText(EngineLine line) { return line.displayScore(sideToMove()); }

    List<EvaluationPoint> evaluationPoints() {
        List<EvaluationPoint> result = new ArrayList<>();
        for (int index = 0; index < history.size(); index++) {
            MoveRecord record = history.get(index);
            Integer normalized = positionScores.containsKey(index) ? positionScores.get(index) : record.beforeScore == null ? null
                    : record.mover == Side.RED ? record.beforeScore : -record.beforeScore;
            result.add(new EvaluationPoint(index, normalized));
        }
        result.add(new EvaluationPoint(history.size(), positionScores.get(history.size())));
        Integer current = globalLines.isEmpty() ? null : globalLines.get(0).centipawns();
        if (current != null && sideToMove() == Side.BLACK) current = -current;
        if (current != null && activePly >= 0 && activePly < result.size()) {
            result.set(activePly, new EvaluationPoint(activePly, current));
        }
        return result;
    }

    void setDepth(int depth) {
        if (!AVAILABLE_DEPTHS.contains(depth) || analysisDepth == depth) return;
        analysisDepth = depth;
        previewedCandidateMove = null;
        PikafishNative.stop();
        backfillGeneration++;
        positionGeneration++;
        selectionGeneration++;
        if (gameMode != GameMode.SETUP) refreshAnalysis();
    }

    boolean canHumanMove() { return gameMode != GameMode.SETUP && (gameMode != GameMode.COMPUTER || sideToMove() == humanSide); }

    void setGameMode(GameMode mode) {
        if (mode == gameMode) return;
        if (gameMode == GameMode.SETUP && mode != GameMode.SETUP) {
            int redKings = 0, blackKings = 0;
            for (BoardPiece piece : pieces()) if (piece.kind == PieceKind.KING) { if (piece.side == Side.RED) redKings++; else blackKings++; }
            if (redKings != 1 || blackKings != 1) { setupMessage = "红帅和黑将必须各保留一枚。"; notifyChanged(); return; }
        }
        cancelComputerMove();
        PikafishNative.stop();
        backfillGeneration++;
        clearSelection();
        setupMessage = null;
        gameMode = mode;
        if (mode == GameMode.SETUP) {
            history.clear(); positionScores.clear(); activePly = 0; timelineEndFen = fen;
            legalMoves = new ArrayList<>(); globalLines = new ArrayList<>(); analyzing = false; setupAction = SetupAction.MOVE;
            notifyChanged();
        } else refreshAnalysis();
    }

    void setHumanSide(Side side) { humanSide = side; cancelComputerMove(); scheduleComputerMove(); notifyChanged(); }
    void setSetupAction(SetupAction action) { setupAction = action; clearSelection(); setupMessage = null; notifyChanged(); }
    void setSetupPiece(Side side, PieceKind kind) { setupAction = SetupAction.PIECE; setupSide = side; setupKind = kind; clearSelection(); setupMessage = null; notifyChanged(); }
    void finishSetup() { setGameMode(GameMode.LOCAL); }
    void toggleSetupSide() { fen = makeFen(pieces(), sideToMove() == Side.RED ? Side.BLACK : Side.RED); timelineEndFen = fen; notifyChanged(); }

    void toggleBestArrows() {
        showBestArrows = !showBestArrows;
        notifyChanged();
    }

    void toggleBoardPerspective() {
        boardFlipped = !boardFlipped;
        notifyChanged();
    }

    void tap(int file, int rank) {
        if (gameMode == GameMode.SETUP) { editSetup(file, rank); return; }
        if (!canHumanMove()) return;
        ParsedPosition position = position();
        BoardPiece selected = selectedPiece();
        if (selected == null) {
            for (BoardPiece piece : position.pieces) {
                if (piece.file == file && piece.rank == rank && piece.side == position.sideToMove) {
                    select(piece);
                    return;
                }
            }
            return;
        }

        for (BoardPiece piece : position.pieces) {
            if (piece.file == file && piece.rank == rank && piece.side == position.sideToMove) {
                select(piece);
                return;
            }
        }

        String destination = "" + (char) ('a' + file) + (9 - rank);
        String move = selected.square() + destination;
        if (selectedLegalMoves().contains(move)) play(move);
    }

    void play(String move) {
        if (gameMode == GameMode.SETUP) return;
        MoveCoordinates points = ChineseNotation.coordinates(move);
        if (points == null) return;
        List<BoardPiece> oldPieces = pieces();
        BoardPiece movingPiece = null;
        for (BoardPiece piece : oldPieces) if (piece.file == points.fromFile && piece.rank == points.fromRank && piece.side == sideToMove()) { movingPiece = piece; break; }
        if (movingPiece == null || !XiangqiRules.isLegal(movingPiece, points.toFile, points.toRank, oldPieces)) return;
        cancelComputerMove();
        previewedCandidateMove = null;
        interruptAnalysis();
        backfillGeneration++;
        final String oldFen = fen;
        final int basePly = activePly;
        Integer before = globalLines.isEmpty() ? null : globalLines.get(0).centipawns();
        String bestMove = globalBestMove();
        MoveRecord record = new MoveRecord(oldFen, move, ChineseNotation.name(move, oldPieces), sideToMove(), before,
                move.equals(bestMove), bestMove == null ? null : ChineseNotation.name(bestMove, oldPieces));
        errorMessage = null;
        analyzing = false;
        globalLines = new ArrayList<>();
        clearSelection();

        // The move has already passed Pikafish's legal-move check. Update the
        // board synchronously so a stopped search can never delay touch input.
        List<BoardPiece> updated = new ArrayList<>();
        for (BoardPiece piece : oldPieces) {
            boolean origin = piece.file == points.fromFile && piece.rank == points.fromRank;
            boolean destination = piece.file == points.toFile && piece.rank == points.toRank;
            if (!origin && !destination) updated.add(piece);
        }
        updated.add(new BoardPiece(movingPiece.side, movingPiece.kind, points.toFile, points.toRank));
        String newFen = makeFen(updated, sideToMove() == Side.RED ? Side.BLACK : Side.RED);
        while (history.size() > basePly) history.remove(history.size() - 1);
        positionScores.keySet().removeIf(ply -> ply > basePly);
        history.add(record);
        fen = newFen;
        activePly = basePly + 1;
        timelineEndFen = newFen;
        legalMoves = new ArrayList<>();
        clearSelection();
        notifyChanged();
        refreshAnalysis();
    }

    void undo() {
        if (activePly == 0) return;
        goToPly(activePly - 1);
    }

    void goToPly(int ply) {
        cancelComputerMove();
        int target = Math.max(0, Math.min(history.size(), ply));
        if (target == activePly) return;
        previewedCandidateMove = null;
        PikafishNative.stop();
        backfillGeneration++;
        positionGeneration++;
        selectionGeneration++;
        fen = target < history.size() ? history.get(target).beforeFen : timelineEndFen;
        activePly = target;
        legalMoves = new ArrayList<>();
        globalLines = new ArrayList<>();
        errorMessage = null;
        analyzing = false;
        clearSelection();
        refreshAnalysis();
    }

    void reset() {
        cancelComputerMove();
        previewedCandidateMove = null;
        PikafishNative.stop();
        backfillGeneration++;
        history.clear();
        positionScores.clear();
        fen = INITIAL_FEN;
        activePly = 0;
        timelineEndFen = INITIAL_FEN;
        recordTitle = "新对局";
        legalMoves = new ArrayList<>();
        clearSelection();
        if (gameMode == GameMode.SETUP) { globalLines = new ArrayList<>(); analyzing = false; notifyChanged(); }
        else refreshAnalysis();
    }

    void loadRecord(GameRecordIO.Record imported) {
        cancelComputerMove(); PikafishNative.stop(); backfillGeneration++; positionGeneration++; selectionGeneration++;
        String current = imported.startFen; List<MoveRecord> records = new ArrayList<>();
        for (String move : imported.moves) {
            ParsedPosition position = ParsedPosition.parse(current); MoveCoordinates points = ChineseNotation.coordinates(move);
            BoardPiece moving = null;
            if (points != null) for (BoardPiece piece : position.pieces) if (piece.file == points.fromFile && piece.rank == points.fromRank) { moving = piece; break; }
            if (moving == null) { recordMessage = "第 " + (records.size() + 1) + " 步的起点没有棋子。"; notifyChanged(); return; }
            records.add(new MoveRecord(current, move, ChineseNotation.name(move, position.pieces), moving.side, null, false, null));
            List<BoardPiece> updated = new ArrayList<>();
            for (BoardPiece piece : position.pieces) if (!((piece.file == points.fromFile && piece.rank == points.fromRank) || (piece.file == points.toFile && piece.rank == points.toRank))) updated.add(piece);
            updated.add(new BoardPiece(moving.side, moving.kind, points.toFile, points.toRank));
            current = makeFen(updated, position.sideToMove == Side.RED ? Side.BLACK : Side.RED);
        }
        history.clear(); history.addAll(records); positionScores.clear(); timelineEndFen = current;
        activePly = Math.max(0, Math.min(imported.activePly, records.size()));
        fen = activePly < records.size() ? records.get(activePly).beforeFen : current;
        recordTitle = imported.title; recordMessage = "已载入“" + imported.title + "”，共 " + records.size() + " 步；可从任意局面续走。";
        gameMode = GameMode.LOCAL; legalMoves = new ArrayList<>(); globalLines = new ArrayList<>(); clearSelection(); refreshAnalysis();
    }

    GameRecordIO.Record currentRecord() {
        List<String> moves = new ArrayList<>(); for (MoveRecord move : history) moves.add(move.uci);
        String start = history.isEmpty() ? fen : history.get(0).beforeFen;
        return new GameRecordIO.Record(recordTitle.equals("新对局") ? "象棋对局" : recordTitle, start, moves, activePly);
    }

    void saveGame() {
        try {
            SharedPreferences preferences = context.getSharedPreferences("games", Context.MODE_PRIVATE);
            JSONArray games = new JSONArray(preferences.getString("saved", "[]"));
            JSONObject json = GameRecordIO.toJson(currentRecord()); json.put("id", System.currentTimeMillis()); games.put(json);
            preferences.edit().putString("saved", games.toString()).apply(); recordTitle = json.getString("title"); recordMessage = "已保存“" + recordTitle + "”。";
        } catch (Exception exception) { recordMessage = exception.getMessage(); }
        notifyChanged();
    }

    List<JSONObject> savedGames() {
        List<JSONObject> result = new ArrayList<>();
        try { JSONArray array = new JSONArray(context.getSharedPreferences("games", Context.MODE_PRIVATE).getString("saved", "[]")); for (int i = array.length() - 1; i >= 0; i--) result.add(array.getJSONObject(i)); }
        catch (Exception ignored) {} return result;
    }

    void clearRecordMessage() { recordMessage = null; notifyChanged(); }

    String notation(EngineLine line) { return ChineseNotation.name(line.firstMove(), pieces()); }

    String quality(EngineLine line, int index) {
        if (index == 0 || globalLines.isEmpty()) return "最佳";
        Integer best = globalLines.get(0).centipawns();
        Integer score = line.centipawns();
        if (best == null || score == null) return "可行";
        int loss = best - score;
        if (loss <= 15) return "优秀";
        if (loss <= 50) return "良好";
        if (loss <= 120) return "可行";
        return "需谨慎";
    }

    Review review() {
        if (activePly == 0) return new Review("待走", "先形成判断，再用引擎验证。", "点击棋子可查看合法落点和皮卡鱼首选。");
        if (analyzing || errorMessage != null || globalLines.isEmpty()) {
            return new Review(errorMessage == null ? "计算中" : "未评分",
                    errorMessage == null ? "正在复盘刚才的着法。" : "本次计算失败，没有生成推测性评价。",
                    errorMessage == null ? "皮卡鱼正在比较走前和走后的评分。" : errorMessage);
        }
        MoveRecord last = history.get(activePly - 1);
        Integer after = globalLines.get(0).centipawns();
        Integer recoveredBefore = positionScores.containsKey(activePly - 1)
                ? (last.mover == Side.RED ? positionScores.get(activePly - 1) : -positionScores.get(activePly - 1))
                : last.beforeScore;
        if (recoveredBefore == null || after == null) return new Review("完成", last.notation, "评分信息正在后台补算。");
        int scoreForMover = -after;
        int loss = recoveredBefore - scoreForMover;
        int beforeForRed = last.mover == Side.RED ? recoveredBefore : -recoveredBefore;
        int afterForRed = last.mover == Side.RED ? scoreForMover : -scoreForMover;
        String summary = String.format(Locale.CHINA, "红方视角评分 %+.2f → %+.2f", beforeForRed / 100.0, afterForRed / 100.0);
        String theme = moveTheme(last);
        String variation = principalVariationText();
        String change = positionChange(recoveredBefore, scoreForMover, loss);
        String alternative = !last.wasEngineBest && last.bestBefore != null
                ? "落子前皮卡鱼首选是" + last.bestBefore + "。" : "";
        String afterText = String.format(Locale.CHINA, "%+.2f", afterForRed / 100.0);
        String outlook = variation.isEmpty()
                ? "按双方最佳应对，落子后的红方视角评分为 " + afterText + "。"
                : "接下来的一条主变化是：" + variation + "。按双方最佳应对，落子后的红方视角评分为 " + afterText + "。";
        if (last.wasEngineBest) return new Review("最佳", summary, theme + "；皮卡鱼在落子前将它排在首位。" + outlook);
        if (loss <= 8) return new Review("最佳", summary, theme + "；" + change + "。" + alternative + outlook);
        if (loss <= 30) return new Review("优秀", summary, theme + "；" + change + "。" + alternative + outlook);
        if (loss <= 80) return new Review("可行", summary, theme + "；" + change + "。" + alternative + outlook);
        if (loss <= 150) return new Review("不准确", summary, theme + "；" + change + "。" + alternative + outlook);
        return new Review("失误", summary, theme + "；" + change + "。" + alternative + outlook);
    }

    private String positionChange(int before, int after, int loss) {
        if (before >= 30 && after <= -30) return "局面由你方占优转为对方占优";
        if (before >= 30 && after < 30) return "原有优势基本被抹平";
        if (before > -30 && after <= -30) return "均衡局面转为对方占优";
        if (before <= -30 && after < before) return "原有劣势进一步扩大";
        if (loss > 8) return String.format(Locale.CHINA, "相对最佳结果，评价下滑了 %.2f", loss / 100.0);
        return "局面评价基本保持稳定";
    }

    private String moveTheme(MoveRecord record) {
        List<BoardPiece> before = ParsedPosition.parse(record.beforeFen).pieces;
        MoveCoordinates coordinates = ChineseNotation.coordinates(record.uci);
        if (coordinates == null) return record.notation + "改变了棋子位置";
        BoardPiece moving = null;
        BoardPiece captured = null;
        for (BoardPiece piece : before) {
            if (piece.file == coordinates.fromFile && piece.rank == coordinates.fromRank) moving = piece;
            if (piece.file == coordinates.toFile && piece.rank == coordinates.toRank) captured = piece;
        }
        if (moving == null) return record.notation + "改变了棋子位置";
        if (captured != null) return record.notation + "用" + moving.name() + "吃掉了对方" + captured.name() + "，直接改变了双方子力和战术关系";
        switch (moving.kind) {
            case CANNON:
                if (coordinates.toFile == 4 && coordinates.fromFile != coordinates.toFile) return record.notation + "把炮转入中路，增强了对将门和中心线的压力";
                return record.notation + "调整了炮的作用线路，为隔子攻击和后续兑子寻找支点";
            case HORSE: return record.notation + "重新安排了马的位置，既要看新控制点，也要确认马腿是否畅通";
            case ROOK: return record.notation + "改变了车所控制的直线，重点在于开放线和侵入点";
            case PAWN: return record.notation + "推进了兵卒，获得空间的同时也永久改变了这一线的结构";
            case ELEPHANT:
            case ADVISOR: return record.notation + "调整了防守阵型，并改变了将帅周围的控制点";
            case KING: return record.notation + "移动了将帅，需要结合对方将军手段判断安全性";
            default: return record.notation + "改变了这枚棋子的活动范围和相关线路";
        }
    }

    private String principalVariationText() {
        if (globalLines.isEmpty()) return "";
        return variationText(globalLines.get(0), 0);
    }

    String continuation(EngineLine line) {
        return variationText(line, 1);
    }

    private String variationText(EngineLine line, int skippedMoves) {
        List<BoardPiece> position = new ArrayList<>(pieces());
        List<String> names = new ArrayList<>();
        String[] moves = line.pv.trim().split("\\s+");
        for (int index = 0; index < Math.min(skippedMoves + 4, moves.length); index++) {
            String move = moves[index];
            MoveCoordinates coordinates = ChineseNotation.coordinates(move);
            if (coordinates == null) continue;
            BoardPiece captured = null;
            for (BoardPiece piece : position) {
                if (piece.file == coordinates.toFile && piece.rank == coordinates.toRank) { captured = piece; break; }
            }
            if (index >= skippedMoves) {
                names.add((names.size() + 1) + "." + ChineseNotation.name(move, position)
                        + (captured == null ? "" : "（吃" + captured.name() + "）"));
            }
            BoardPiece moving = null;
            for (BoardPiece piece : position) {
                if (piece.file == coordinates.fromFile && piece.rank == coordinates.fromRank) { moving = piece; break; }
            }
            if (moving == null) continue;
            BoardPiece moved = moving;
            position.removeIf(piece -> (piece.file == coordinates.toFile && piece.rank == coordinates.toRank)
                    || (piece.file == coordinates.fromFile && piece.rank == coordinates.fromRank));
            position.add(new BoardPiece(moved.side, moved.kind, coordinates.toFile, coordinates.toRank));
        }
        return String.join(" → ", names);
    }

    void close() {
        cancelComputerMove();
        PikafishNative.stop();
        backfillGeneration++;
        engineQueue.shutdownNow();
        interruptQueue.shutdownNow();
    }

    private void select(BoardPiece piece) {
        previewedCandidateMove = null;
        selectedSquare = piece.square();
        selectedLines = new ArrayList<>();
        analyzingSelection = true;
        List<String> moves = XiangqiRules.legalMoves(piece, pieces());
        String fenAtStart = fen;
        int depthAtStart = analysisDepth;
        int generation = ++selectionGeneration;
        notifyChanged();

        if (moves.isEmpty()) {
            analyzingSelection = false;
            notifyChanged();
            return;
        }
        main.postDelayed(() -> {
            if (selectionGeneration != generation || !fen.equals(fenAtStart)) return;
            // The piece-specific request replaces the global deep pass. Mark it
            // stale before stopping native search so it cannot enqueue stage two.
            positionGeneration++;
            analyzing = false;
            interruptAnalysis();
            backfillGeneration++;
            engineQueue.execute(() -> {
            try {
                if (selectionGeneration != generation) return;
                ensureInitialized();
                if (selectionGeneration != generation) return;
                int previewDepth = Math.min(7, depthAtStart);
                List<EngineLine> previewLines = analyze(fenAtStart, previewDepth, Math.min(12, moves.size()), moves);
                main.post(() -> {
                    if (selectionGeneration != generation || !fen.equals(fenAtStart) || analysisDepth != depthAtStart) return;
                    selectedLines = previewLines;
                    notifyChanged();
                });
                List<EngineLine> completedLines = previewLines;
                if (previewDepth < depthAtStart) {
                    if (selectionGeneration != generation || !fen.equals(fenAtStart)) return;
                    completedLines = analyze(fenAtStart, depthAtStart, Math.min(12, moves.size()), moves);
                }
                List<EngineLine> finalLines = completedLines;
                main.post(() -> {
                    if (selectionGeneration != generation || !fen.equals(fenAtStart) || analysisDepth != depthAtStart) return;
                    selectedLines = finalLines;
                    analyzingSelection = false;
                    notifyChanged();
                });
            } catch (Exception ignored) {
                main.post(() -> {
                    if (selectionGeneration != generation) return;
                    selectedLines = new ArrayList<>();
                    analyzingSelection = false;
                    notifyChanged();
                });
            }
            });
        }, 800);
    }

    private void clearSelection() {
        selectionGeneration++;
        selectedSquare = null;
        selectedLines = new ArrayList<>();
        analyzingSelection = false;
    }

    private void refreshAnalysis() {
        if (gameMode == GameMode.SETUP) return;
        final String fenAtStart = fen;
        final int depthAtStart = analysisDepth;
        final int generation = ++positionGeneration;
        backfillGeneration++;
        analyzing = true;
        errorMessage = null;
        globalLines = new ArrayList<>();
        notifyChanged();
        interruptAnalysis();

        engineQueue.execute(() -> {
            try {
                if (positionGeneration != generation) return;
                ensureInitialized();
                if (positionGeneration != generation) return;
                int previewDepth = Math.min(7, depthAtStart);
                List<EngineLine> previewLines = analyze(fenAtStart, previewDepth, 5, Collections.emptyList());
                main.post(() -> {
                    if (positionGeneration != generation || !fen.equals(fenAtStart) || analysisDepth != depthAtStart) return;
                    globalLines = previewLines;
                    notifyChanged();
                });
                List<EngineLine> completedLines = previewLines;
                if (previewDepth < depthAtStart) {
                    if (positionGeneration != generation || !fen.equals(fenAtStart)) return;
                    completedLines = analyze(fenAtStart, depthAtStart, 5, Collections.emptyList());
                }
                List<EngineLine> finalLines = completedLines;
                main.post(() -> {
                    if (positionGeneration != generation || !fen.equals(fenAtStart) || analysisDepth != depthAtStart) return;
                    globalLines = finalLines;
                    Integer score = finalLines.isEmpty() ? null : finalLines.get(0).centipawns();
                    if (score != null) positionScores.put(activePly, sideToMove() == Side.RED ? score : -score);
                    analyzing = false;
                    errorMessage = null;
                    notifyChanged();
                    scheduleComputerMove();
                    BoardPiece selected = selectedPiece();
                    if (selected != null && !analyzingSelection && selectedLines.isEmpty()) select(selected);
                    scheduleScoreBackfill();
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (positionGeneration != generation) return;
                    errorMessage = error.getMessage();
                    analyzing = false;
                    notifyChanged();
                });
            }
        });
    }

    private void scheduleScoreBackfill() {
        if (gameMode == GameMode.SETUP) return;
        List<Integer> missing = new ArrayList<>();
        for (int ply = 0; ply <= history.size(); ply++) {
            if (ply != activePly && !positionScores.containsKey(ply)) missing.add(ply);
        }
        if (missing.isEmpty()) return;
        final int generation = ++backfillGeneration;
        final int depth = Math.min(10, analysisDepth);
        final List<String> snapshots = new ArrayList<>();
        for (int ply : missing) snapshots.add(ply < history.size() ? history.get(ply).beforeFen : timelineEndFen);
        engineQueue.execute(() -> {
            for (int index = 0; index < missing.size(); index++) {
                if (generation != backfillGeneration) return;
                try {
                    String snapshot = snapshots.get(index);
                    List<EngineLine> lines = analyze(snapshot, depth, 1, Collections.emptyList());
                    Integer score = lines.isEmpty() ? null : lines.get(0).centipawns();
                    if (score == null) continue;
                    int ply = missing.get(index);
                    Side side = ParsedPosition.parse(snapshot).sideToMove;
                    int normalized = side == Side.RED ? score : -score;
                    main.post(() -> {
                        if (generation != backfillGeneration) return;
                        positionScores.put(ply, normalized);
                        notifyChanged();
                    });
                } catch (Exception ignored) {
                    if (generation != backfillGeneration) return;
                }
            }
        });
    }

    private void editSetup(int file, int rank) {
        List<BoardPiece> updated = new ArrayList<>(pieces());
        setupMessage = null;
        if (setupAction == SetupAction.ERASE) {
            updated.removeIf(piece -> piece.file == file && piece.rank == rank);
            clearSelection();
        } else if (setupAction == SetupAction.MOVE) {
            BoardPiece selected = selectedPiece();
            if (selected == null) {
                for (BoardPiece piece : updated) if (piece.file == file && piece.rank == rank) { selectedSquare = piece.square(); notifyChanged(); return; }
                return;
            }
            if (selected.file == file && selected.rank == rank) { clearSelection(); notifyChanged(); return; }
            updated.removeIf(piece -> (piece.file == file && piece.rank == rank) || piece.square().equals(selected.square()));
            updated.add(new BoardPiece(selected.side, selected.kind, file, rank));
            clearSelection();
        } else {
            updated.removeIf(piece -> piece.file == file && piece.rank == rank);
            updated.add(new BoardPiece(setupSide, setupKind, file, rank));
        }
        fen = makeFen(updated, sideToMove()); timelineEndFen = fen; notifyChanged();
    }

    private void scheduleComputerMove() {
        cancelComputerMove();
        if (gameMode == GameMode.COMPUTER && sideToMove() != humanSide && !analyzing && !globalLines.isEmpty()) main.postDelayed(computerMove, 520);
    }

    private void cancelComputerMove() { main.removeCallbacks(computerMove); }

    private void interruptAnalysis() { interruptQueue.execute(PikafishNative::stop); }

    private String makeFen(List<BoardPiece> pieces, Side side) {
        StringBuilder board = new StringBuilder();
        for (int rank = 0; rank < 10; rank++) {
            if (rank > 0) board.append('/');
            int empty = 0;
            for (int file = 0; file < 9; file++) {
                BoardPiece found = null;
                for (BoardPiece piece : pieces) if (piece.file == file && piece.rank == rank) { found = piece; break; }
                if (found == null) { empty++; continue; }
                if (empty > 0) { board.append(empty); empty = 0; }
                char value;
                switch (found.kind) { case ROOK: value='r'; break; case HORSE: value='n'; break; case ELEPHANT: value='b'; break; case ADVISOR: value='a'; break; case KING: value='k'; break; case CANNON: value='c'; break; default: value='p'; }
                board.append(found.side == Side.RED ? Character.toUpperCase(value) : value);
            }
            if (empty > 0) board.append(empty);
        }
        return board + " " + (side == Side.RED ? "w" : "b") + " - - 0 1";
    }

    private List<EngineLine> analyze(String fen, int depth, int multipv, List<String> searchMoves) throws Exception {
        String payloadText = PikafishNative.analyze(fen, depth, multipv, String.join(" ", searchMoves));
        JSONObject payload = new JSONObject(payloadText);
        if (!payload.isNull("error")) throw new IllegalStateException(payload.getString("error"));
        JSONArray jsonLines = payload.getJSONArray("lines");
        List<EngineLine> lines = new ArrayList<>();
        for (int index = 0; index < jsonLines.length(); index++) lines.add(new EngineLine(jsonLines.getJSONObject(index)));
        lines.sort(Comparator.comparingInt(line -> line.multipv));
        return lines;
    }

    private List<String> parseMoves(String response) {
        if (response.startsWith("error:")) throw new IllegalStateException(response.substring(6));
        String value = response.trim();
        if (value.isEmpty()) return new ArrayList<>();
        return new ArrayList<>(Arrays.asList(value.split("\\s+")));
    }

    private synchronized void ensureInitialized() throws Exception {
        if (initialized) return;
        File network = new File(context.getFilesDir(), "pikafish.nnue");
        if (!network.exists() || network.length() < 1_000_000) {
            try (InputStream input = context.getAssets().open("pikafish.nnue");
                 FileOutputStream output = new FileOutputStream(network)) {
                byte[] buffer = new byte[1024 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            }
        }
        int processors = Runtime.getRuntime().availableProcessors();
        // Reserve CPU capacity for rendering and touch handling while the engine
        // searches in the background.
        int threads = Math.max(1, Math.min(3, processors - 2));
        String response = PikafishNative.initialize(network.getAbsolutePath(), threads, 64);
        if (!"ready".equals(response)) throw new IllegalStateException(response.startsWith("error:") ? response.substring(6) : response);
        initialized = true;
    }

    private void notifyChanged() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(this::notifyChanged);
            return;
        }
        if (listener != null) listener.onStateChanged();
    }

    static final class Review {
        final String grade, summary, detail;
        Review(String grade, String summary, String detail) {
            this.grade = grade;
            this.summary = summary;
            this.detail = detail;
        }
    }
}
