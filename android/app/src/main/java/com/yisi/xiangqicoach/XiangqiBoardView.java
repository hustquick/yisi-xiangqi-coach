package com.yisi.xiangqicoach;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.animation.PathInterpolator;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class XiangqiBoardView extends View {
    private static final int BOARD = Color.rgb(222, 180, 113);
    private static final int LINE = Color.rgb(62, 51, 34);
    private static final int RED = Color.rgb(185, 38, 29);
    private static final int BLUE = Color.rgb(56, 111, 212);
    private static final int GREEN = Color.rgb(26, 145, 82);
    private static final int PIECE = Color.rgb(248, 222, 171);
    private static final int[] ARROW_COLORS = {
            Color.rgb(23, 125, 78), Color.rgb(221, 126, 45),
            Color.rgb(55, 105, 199), Color.rgb(127, 78, 190)
    };

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final int touchSlop;
    private CoachController controller;
    private float downX, downY;
    private boolean moved;
    private float cell, originX, originY;
    private final Handler previewHandler = new Handler(Looper.getMainLooper());
    private final List<VariationFrame> variationFrames = new ArrayList<>();
    private int variationFrameIndex = -1;
    private float variationProgress;
    private ValueAnimator variationAnimator;
    private Integer timelinePreviewPly;
    private String previewBaseFen;
    private final Runnable advanceVariation = new Runnable() {
        @Override public void run() {
            if (variationFrameIndex < 0) return;
            if (variationFrameIndex + 1 < variationFrames.size()) {
                variationFrameIndex++;
                variationProgress = 0f;
                invalidate();
                ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);
                variationAnimator = animator;
                animator.setDuration(620);
                animator.setInterpolator(new PathInterpolator(0.20f, 0.78f, 0.24f, 1f));
                animator.addUpdateListener(value -> {
                    variationProgress = (float) value.getAnimatedValue();
                    invalidate();
                });
                animator.addListener(new AnimatorListenerAdapter() {
                    @Override public void onAnimationEnd(Animator animation) {
                        if (variationAnimator != animation || variationFrameIndex < 0) return;
                        variationAnimator = null;
                        previewHandler.postDelayed(advanceVariation, 260);
                    }
                });
                animator.start();
            } else {
                previewHandler.postDelayed(() -> stopVariation(), 1150);
            }
        }
    };

    XiangqiBoardView(Context context) { this(context, null); }

    XiangqiBoardView(Context context, AttributeSet attrs) {
        super(context, attrs);
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        setContentDescription("中国象棋棋盘");
        setFocusable(true);
    }

    void setController(CoachController controller) {
        this.controller = controller;
        invalidate();
    }

    void startVariation(EngineLine line) {
        if (controller == null) return;
        stopVariation();
        timelinePreviewPly = null;
        previewBaseFen = controller.fen;
        List<BoardPiece> position = new ArrayList<>(controller.pieces());
        variationFrames.add(new VariationFrame(new ArrayList<>(position),
                controller.notation(line) + " · 准备演示", "准备", null, null, null));
        String[] moves = line.pv.trim().split("\\s+");
        // Nine complete rounds contain at most eighteen individual moves.
        for (int index = 0; index < Math.min(18, moves.length); index++) {
            MoveCoordinates coordinates = ChineseNotation.coordinates(moves[index]);
            if (coordinates == null) continue;
            BoardPiece moving = null;
            for (BoardPiece piece : position) {
                if (piece.file == coordinates.fromFile && piece.rank == coordinates.fromRank) {
                    moving = piece;
                    break;
                }
            }
            if (moving == null) continue;
            String notation = ChineseNotation.name(moves[index], position);
            BoardPiece captured = null;
            for (BoardPiece piece : position) {
                if (piece.file == coordinates.toFile && piece.rank == coordinates.toRank) {
                    captured = piece;
                    break;
                }
            }
            String step = (index / 2 + 1) + (index % 2 == 0 ? "a" : "b");
            variationFrames.add(new VariationFrame(new ArrayList<>(position), notation, step,
                    coordinates, moving, captured));
            BoardPiece moved = moving;
            position.removeIf(piece -> (piece.file == coordinates.toFile && piece.rank == coordinates.toRank)
                    || (piece.file == coordinates.fromFile && piece.rank == coordinates.fromRank));
            position.add(new BoardPiece(moved.side, moved.kind, coordinates.toFile, coordinates.toRank));
            if (captured != null && captured.kind == PieceKind.KING) break;
        }
        if (variationFrames.size() <= 1) {
            stopVariation();
            return;
        }
        variationFrameIndex = 0;
        variationProgress = 0f;
        invalidate();
        previewHandler.postDelayed(advanceVariation, 360);
    }

    void stopVariation() {
        previewHandler.removeCallbacksAndMessages(null);
        ValueAnimator animator = variationAnimator;
        variationAnimator = null;
        if (animator != null) animator.cancel();
        variationFrames.clear();
        variationFrameIndex = -1;
        variationProgress = 0f;
        previewBaseFen = null;
        invalidate();
    }

    void setTimelinePreview(Integer ply) {
        if (ply != null) stopVariation();
        timelinePreviewPly = ply;
        invalidate();
    }

    private boolean previewingVariation() {
        return variationFrameIndex >= 0 && variationFrameIndex < variationFrames.size();
    }

    private List<BoardPiece> displayedPieces() {
        if (previewingVariation()) {
            VariationFrame frame = variationFrames.get(variationFrameIndex);
            if (frame.movingPiece == null) return frame.pieces;
            List<BoardPiece> stationary = new ArrayList<>();
            for (BoardPiece piece : frame.pieces) {
                if (piece != frame.movingPiece && piece != frame.capturedPiece) stationary.add(piece);
            }
            return stationary;
        }
        if (timelinePreviewPly != null && controller != null) return controller.piecesAtPly(timelinePreviewPly);
        return controller == null ? Collections.emptyList() : controller.pieces();
    }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int width = MeasureSpec.getSize(widthMeasureSpec);
        if (MeasureSpec.getMode(widthMeasureSpec) == MeasureSpec.UNSPECIFIED) width = dp(360);
        int desiredHeight = Math.round(width / 0.77f);
        setMeasuredDimension(resolveSize(width, widthMeasureSpec), resolveSize(desiredHeight, heightMeasureSpec));
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float width = getWidth();
        float height = getHeight();
        cell = Math.min((width - dp(44)) / 8f, (height - dp(86)) / 9f);
        originX = (width - cell * 8) / 2f;
        originY = (height - cell * 9) / 2f;

        paint.setStyle(Paint.Style.FILL);
        paint.setColor(BOARD);
        canvas.drawRoundRect(new RectF(0, 0, width, height), dp(10), dp(10), paint);
        drawBoardLines(canvas);
        drawCoordinates(canvas);
        drawRiver(canvas);
        if (controller == null) return;
        if (previewingVariation() && !controller.fen.equals(previewBaseFen)) stopVariation();
        drawGlobalArrows(canvas);
        drawMoveMarkers(canvas);
        drawPieces(canvas);
        drawPreviewMarkers(canvas);
        drawMovingPreviewPieces(canvas);
        drawPreviewBanner(canvas);
    }

    private void drawBoardLines(Canvas canvas) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1f, cell * 0.018f));
        paint.setColor(withAlpha(LINE, 210));
        path.reset();
        for (int rank = 0; rank <= 9; rank++) {
            path.moveTo(x(0), y(rank));
            path.lineTo(x(8), y(rank));
        }
        for (int file = 0; file <= 8; file++) {
            if (file == 0 || file == 8) {
                path.moveTo(x(file), y(0));
                path.lineTo(x(file), y(9));
            } else {
                path.moveTo(x(file), y(0));
                path.lineTo(x(file), y(4));
                path.moveTo(x(file), y(5));
                path.lineTo(x(file), y(9));
            }
        }
        path.moveTo(x(3), y(0)); path.lineTo(x(5), y(2));
        path.moveTo(x(5), y(0)); path.lineTo(x(3), y(2));
        path.moveTo(x(3), y(7)); path.lineTo(x(5), y(9));
        path.moveTo(x(5), y(7)); path.lineTo(x(3), y(9));
        canvas.drawPath(path, paint);
    }

    private void drawCoordinates(Canvas canvas) {
        paint.setStyle(Paint.Style.FILL);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        paint.setTextSize(Math.max(dp(17), cell * 0.30f));
        String[] topFiles = isFlipped()
                ? new String[]{"一", "二", "三", "四", "五", "六", "七", "八", "九"}
                : new String[]{"1", "2", "3", "4", "5", "6", "7", "8", "9"};
        String[] bottomFiles = isFlipped()
                ? new String[]{"9", "8", "7", "6", "5", "4", "3", "2", "1"}
                : new String[]{"九", "八", "七", "六", "五", "四", "三", "二", "一"};
        for (int displayFile = 0; displayFile < 9; displayFile++) {
            float displayX = originX + displayFile * cell;
            paint.setColor(isFlipped() ? withAlpha(RED, 220) : withAlpha(LINE, 200));
            canvas.drawText(topFiles[displayFile], displayX, originY - dp(18), paint);
            paint.setColor(isFlipped() ? withAlpha(LINE, 200) : withAlpha(RED, 220));
            canvas.drawText(bottomFiles[displayFile], displayX, originY + cell * 9 + dp(31), paint);
        }
    }

    private void drawRiver(Canvas canvas) {
        paint.setColor(withAlpha(LINE, 115));
        paint.setTypeface(android.graphics.Typeface.create("serif", android.graphics.Typeface.BOLD));
        paint.setTextSize(cell * 0.34f);
        paint.setTextAlign(Paint.Align.CENTER);
        float baseline = originY + cell * 4.5f - (paint.ascent() + paint.descent()) / 2;
        canvas.drawText("楚 河", x(2), baseline, paint);
        canvas.drawText("漢 界", x(6), baseline, paint);
    }

    private void drawGlobalArrows(Canvas canvas) {
        if (previewingVariation() || timelinePreviewPly != null || !controller.showBestArrows || controller.globalLines.isEmpty()) return;
        int count = Math.min(4, controller.globalLines.size());
        for (int index = 0; index < count; index++) {
            MoveCoordinates move = ChineseNotation.coordinates(controller.globalLines.get(index).firstMove());
            if (move == null) continue;
            float startX = x(move.fromFile), startY = y(move.fromRank);
            float endX = x(move.toFile), endY = y(move.toRank);
            float dx = endX - startX, dy = endY - startY;
            float length = (float) Math.hypot(dx, dy);
            if (length < 1f) continue;
            float ux = dx / length, uy = dy / length;
            boolean targetOccupied = false;
            for (BoardPiece piece : displayedPieces()) {
                if (piece.file == move.toFile && piece.rank == move.toRank) {
                    targetOccupied = true;
                    break;
                }
            }
            float startInset = Math.min(cell * 0.43f, length * 0.30f);
            float endInset = targetOccupied ? Math.min(cell * 0.43f, length * 0.30f) : 0f;
            float sx = startX + ux * startInset, sy = startY + uy * startInset;
            float ex = endX - ux * endInset, ey = endY - uy * endInset;
            int color = ARROW_COLORS[index];
            float lineWidth = index == 0 ? cell * 0.095f : cell * 0.07f;
            float head = cell * (index == 0 ? 0.22f : 0.18f);
            float px = -uy, py = ux;
            float visibleLength = (float) Math.hypot(ex - sx, ey - sy);
            float preferredRadius = cell * (index == 0 ? 0.18f : 0.15f);
            boolean labelFitsOnShaft = visibleLength > preferredRadius * 2.8f + head;
            float labelRadius = labelFitsOnShaft
                    ? preferredRadius
                    : Math.min(preferredRadius, Math.max(dp(7), visibleLength * 0.24f));
            float labelBaseX = sx + (ex - sx) * 0.46f;
            float labelBaseY = sy + (ey - sy) * 0.46f;
            float labelOffset = labelFitsOnShaft ? 0f : cell * (((index + 1) % 2 == 0) ? -0.22f : 0.22f);
            float mx = labelBaseX + px * labelOffset;
            float my = labelBaseY + py * labelOffset;

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeWidth(lineWidth);
            paint.setColor(withAlpha(color, index == 0 ? 225 : 185));
            if (labelFitsOnShaft) {
                float gap = labelRadius + lineWidth * 0.62f;
                canvas.drawLine(sx, sy, mx - ux * gap, my - uy * gap, paint);
                canvas.drawLine(mx + ux * gap, my + uy * gap, ex, ey, paint);
            } else {
                canvas.drawLine(sx, sy, ex, ey, paint);
            }

            path.reset();
            path.moveTo(ex, ey);
            path.lineTo(ex - ux * head + px * head * 0.55f, ey - uy * head + py * head * 0.55f);
            path.lineTo(ex - ux * head - px * head * 0.55f, ey - uy * head - py * head * 0.55f);
            path.close();
            paint.setStyle(Paint.Style.FILL);
            canvas.drawPath(path, paint);

            paint.setColor(color);
            canvas.drawCircle(mx, my, labelRadius, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(1.5f));
            paint.setColor(withAlpha(Color.WHITE, 235));
            canvas.drawCircle(mx, my, labelRadius, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            paint.setTextSize(labelRadius * 1.08f);
            canvas.drawText(String.valueOf(index + 1), mx, my - (paint.ascent() + paint.descent()) / 2f, paint);
        }
        paint.setStrokeCap(Paint.Cap.BUTT);
    }

    private void drawMoveMarkers(Canvas canvas) {
        if (previewingVariation() || timelinePreviewPly != null) return;
        String best = controller.selectedBestMove();
        for (String move : controller.selectedLegalMoves()) {
            MoveCoordinates points = ChineseNotation.coordinates(move);
            if (points == null) continue;
            boolean isBest = move.equals(best);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(isBest ? GREEN : BLUE);
            canvas.drawCircle(x(points.toFile), y(points.toRank), cell * (isBest ? 0.17f : 0.11f), paint);
            if (isBest) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(dp(2));
                paint.setColor(withAlpha(Color.WHITE, 220));
                canvas.drawCircle(x(points.toFile), y(points.toRank), cell * 0.17f, paint);
            }
        }
    }

    private void drawPieces(Canvas canvas) {
        boolean previewing = previewingVariation() || timelinePreviewPly != null;
        List<String> selectedMoves = previewing ? Collections.emptyList() : controller.selectedLegalMoves();
        String selectedBest = previewing ? null : controller.selectedBestMove();
        for (BoardPiece piece : displayedPieces()) {
            String targetMove = null;
            for (String move : selectedMoves) {
                MoveCoordinates points = ChineseNotation.coordinates(move);
                if (points != null && points.toFile == piece.file && points.toRank == piece.rank) {
                    targetMove = move;
                    break;
                }
            }
            if (targetMove != null) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(targetMove.equals(selectedBest) ? dp(5) : dp(3));
                paint.setColor(targetMove.equals(selectedBest) ? GREEN : BLUE);
                canvas.drawCircle(x(piece.file), y(piece.rank), cell * 0.46f, paint);
            }

            drawPieceAt(canvas, piece, x(piece.file), y(piece.rank), 1f, 255, false);

            if (!previewing && piece.square().equals(controller.selectedSquare)) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(Math.max(dp(3), cell * 0.055f));
                paint.setColor(Color.rgb(20, 118, 235));
                canvas.drawCircle(x(piece.file), y(piece.rank), cell * 0.44f, paint);
            }
        }
    }

    private void drawPreviewMarkers(Canvas canvas) {
        if (!previewingVariation()) return;
        MoveCoordinates move = variationFrames.get(variationFrameIndex).move;
        if (move == null) return;
        float fromX = x(move.fromFile), fromY = y(move.fromRank);
        float toX = x(move.toFile), toY = y(move.toRank);
        float currentX = fromX + (toX - fromX) * variationProgress;
        float currentY = fromY + (toY - fromY) * variationProgress;
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeWidth(Math.max(dp(2), cell * 0.035f));
        paint.setPathEffect(new DashPathEffect(new float[]{dp(5), dp(6)}, 0));
        paint.setColor(withAlpha(GREEN, 82));
        canvas.drawLine(fromX, fromY, currentX, currentY, paint);
        paint.setPathEffect(null);
        paint.setStrokeWidth(Math.max(dp(2), cell * 0.045f));
        paint.setColor(withAlpha(GREEN, Math.round(90 + variationProgress * 140)));
        canvas.drawCircle(toX, toY, cell * (0.36f + variationProgress * 0.07f), paint);
        paint.setStrokeCap(Paint.Cap.BUTT);
        paint.setStyle(Paint.Style.FILL);
    }

    private void drawMovingPreviewPieces(Canvas canvas) {
        if (!previewingVariation()) return;
        VariationFrame frame = variationFrames.get(variationFrameIndex);
        if (frame.move == null || frame.movingPiece == null) return;
        float progress = variationProgress;
        if (frame.capturedPiece != null) {
            float capturePhase = Math.max(0f, (progress - 0.70f) / 0.30f);
            int alpha = Math.round(255 * (1f - capturePhase));
            float scale = Math.max(0.72f, 1f - capturePhase * 0.28f);
            drawPieceAt(canvas, frame.capturedPiece,
                    x(frame.capturedPiece.file), y(frame.capturedPiece.rank), scale, alpha, false);
        }
        float fromX = x(frame.move.fromFile), fromY = y(frame.move.fromRank);
        float toX = x(frame.move.toFile), toY = y(frame.move.toRank);
        float lift = (float) Math.sin(progress * Math.PI);
        drawPieceAt(canvas, frame.movingPiece,
                fromX + (toX - fromX) * progress,
                fromY + (toY - fromY) * progress,
                1f + lift * 0.075f, 255, true);
    }

    private void drawPieceAt(Canvas canvas, BoardPiece piece, float centerX, float centerY,
                             float scale, int alpha, boolean elevated) {
        float radius = cell * 0.39f * scale;
        if (elevated) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(Math.round(35 + 45 * (scale - 1f) / 0.075f), 0, 0, 0));
            canvas.drawCircle(centerX, centerY + cell * 0.07f, radius * 1.03f, paint);
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(withAlpha(PIECE, alpha));
        canvas.drawCircle(centerX, centerY, radius, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(dp(1.8f), cell * 0.035f));
        paint.setColor(withAlpha(piece.side == Side.RED ? RED : LINE, alpha));
        canvas.drawCircle(centerX, centerY, radius, paint);

        paint.setStyle(Paint.Style.FILL);
        paint.setColor(withAlpha(piece.side == Side.RED ? RED : LINE, alpha));
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTypeface(android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL));
        paint.setTextSize(cell * 0.45f * scale);
        canvas.drawText(piece.name(), centerX, centerY - (paint.ascent() + paint.descent()) / 2f, paint);
    }

    private void drawPreviewBanner(Canvas canvas) {
        String text;
        if (previewingVariation()) {
            VariationFrame frame = variationFrames.get(variationFrameIndex);
            text = "▶ " + frame.step + "  " + frame.notation;
        } else if (timelinePreviewPly != null) {
            text = timelinePreviewPly == 0 ? "↔ 滑移预览 · 开局" : "↔ 滑移预览 · 第 " + timelinePreviewPly + " 步后";
        } else return;
        paint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.BOLD));
        paint.setTextSize(dp(12));
        float textWidth = paint.measureText(text);
        float padding = dp(11);
        float left = (getWidth() - textWidth) / 2f - padding;
        float right = (getWidth() + textWidth) / 2f + padding;
        RectF bubble = new RectF(left, dp(9), right, dp(39));
        paint.setColor(Color.argb(235, 250, 248, 241));
        canvas.drawRoundRect(bubble, dp(16), dp(16), paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(1));
        paint.setColor(withAlpha(GREEN, 120));
        canvas.drawRoundRect(bubble, dp(16), dp(16), paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(GREEN);
        paint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText(text, getWidth() / 2f, bubble.centerY() - (paint.ascent() + paint.descent()) / 2f, paint);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (controller == null) return false;
        if (previewingVariation() || timelinePreviewPly != null) return true;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = event.getX(); downY = event.getY(); moved = false; return true;
            case MotionEvent.ACTION_MOVE:
                if (Math.hypot(event.getX() - downX, event.getY() - downY) > touchSlop) moved = true;
                return true;
            case MotionEvent.ACTION_UP:
                if (!moved) {
                    int displayFile = Math.round((event.getX() - originX) / cell);
                    int displayRank = Math.round((event.getY() - originY) / cell);
                    int file = isFlipped() ? 8 - displayFile : displayFile;
                    int rank = isFlipped() ? 9 - displayRank : displayRank;
                    if (displayFile >= 0 && displayFile <= 8 && displayRank >= 0 && displayRank <= 9
                            && Math.hypot(event.getX() - x(file), event.getY() - y(rank)) <= cell * 0.50f) {
                        controller.tap(file, rank);
                        performClick();
                    }
                }
                return true;
            case MotionEvent.ACTION_CANCEL: return false;
            default: return super.onTouchEvent(event);
        }
    }

    @Override public boolean performClick() {
        super.performClick();
        return true;
    }

    private boolean isFlipped() { return controller != null && controller.boardFlipped; }
    private float x(int file) { return originX + (isFlipped() ? 8 - file : file) * cell; }
    private float y(int rank) { return originY + (isFlipped() ? 9 - rank : rank) * cell; }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private int withAlpha(int color, int alpha) { return (color & 0x00FFFFFF) | (alpha << 24); }

    private static final class VariationFrame {
        final List<BoardPiece> pieces;
        final String notation;
        final String step;
        final MoveCoordinates move;
        final BoardPiece movingPiece;
        final BoardPiece capturedPiece;

        VariationFrame(List<BoardPiece> pieces, String notation, String step, MoveCoordinates move,
                       BoardPiece movingPiece, BoardPiece capturedPiece) {
            this.pieces = pieces;
            this.notation = notation;
            this.step = step;
            this.move = move;
            this.movingPiece = movingPiece;
            this.capturedPiece = capturedPiece;
        }
    }
}
