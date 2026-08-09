package com.yisi.xiangqicoach;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PointF;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class SituationChartView extends View {
    private static final int RED = Color.rgb(186, 43, 33);
    private static final int BLACK = Color.rgb(31, 35, 31);
    private static final int GREEN = Color.rgb(24, 126, 80);
    private static final int MUTED = Color.rgb(125, 125, 120);

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float density;
    private CoachController controller;
    private XiangqiBoardView boardView;
    private Integer scrubPly;

    SituationChartView(Context context) { this(context, null); }

    SituationChartView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;
        setClickable(true);
        setFocusable(true);
        setContentDescription("局势评分曲线，按住滑移可预览，松手到达该步");
    }

    void setController(CoachController controller) {
        this.controller = controller;
        invalidate();
    }

    void setBoardView(XiangqiBoardView boardView) { this.boardView = boardView; }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int desiredHeight = Math.round(245 * density);
        int height = resolveSize(desiredHeight, heightMeasureSpec);
        int width = resolveSize(Math.round(320 * density), widthMeasureSpec);
        setMeasuredDimension(width, height);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (controller == null) return;

        List<EvaluationPoint> points = controller.evaluationPoints();
        List<Integer> scores = new ArrayList<>();
        int largest = 0;
        for (EvaluationPoint point : points) {
            if (point.score == null) continue;
            scores.add(point.score);
            largest = Math.max(largest, Math.abs(point.score));
        }
        int range = Math.max(300, (int) Math.ceil(largest / 100.0) * 100);
        float left = 48 * density;
        float top = 17 * density;
        float right = getWidth() - 10 * density;
        float bottom = getHeight() - 30 * density;
        float width = Math.max(1, right - left);
        float height = Math.max(1, bottom - top);
        int finalPly = points.isEmpty() ? 0 : points.get(points.size() - 1).ply;
        int lastPly = Math.max(finalPly, 1);
        int displayedPly = scrubPly == null ? controller.activePly : scrubPly;

        paint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL));
        paint.setTextSize(10 * density);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setTextAlign(Paint.Align.RIGHT);
        float[] fractions = {-1f, -0.5f, 0f, 0.5f, 1f};
        for (float fraction : fractions) {
            float y = (top + bottom) / 2f - fraction * height / 2f;
            paint.setColor(fraction == 0 ? Color.argb(85, 0, 0, 0) : Color.argb(31, 0, 0, 0));
            paint.setStrokeWidth((fraction == 0 ? 1.4f : 1f) * density);
            canvas.drawLine(left, y, right, y, paint);
            int value = Math.round(range * fraction);
            String label = value == 0 ? "0" : String.format(Locale.CHINA, "%+.1f", value / 100.0);
            paint.setColor(MUTED);
            canvas.drawText(label, left - 7 * density, y + 3.5f * density, paint);
        }

        paint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.BOLD));
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setColor(RED);
        canvas.drawText("红优", left, top - 4 * density, paint);
        paint.setColor(BLACK);
        canvas.drawText("黑优", left, bottom + 13 * density, paint);
        paint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL));
        paint.setColor(MUTED);
        paint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("0", left, bottom + 24 * density, paint);
        paint.setTextAlign(Paint.Align.RIGHT);
        canvas.drawText((points.isEmpty() ? 0 : points.get(points.size() - 1).ply) + " 步", right, bottom + 24 * density, paint);

        for (int index = 1; index < points.size(); index++) {
            EvaluationPoint previous = points.get(index - 1);
            EvaluationPoint current = points.get(index);
            if (previous.score == null || current.score == null || current.ply != previous.ply + 1) continue;
            PointF start = position(previous, previous.score, range, lastPly, left, top, width, height);
            PointF end = position(current, current.score, range, lastPly, left, top, width, height);
            drawSegment(canvas, start, previous.score, end, current.score);
        }

        if (displayedPly >= 0 && displayedPly < points.size()) {
            EvaluationPoint active = points.get(displayedPly);
            PointF marker = position(active, active.score == null ? 0 : active.score, range, lastPly, left, top, width, height);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.5f * density);
            paint.setColor(Color.argb(125, 24, 126, 80));
            paint.setPathEffect(new android.graphics.DashPathEffect(new float[]{5 * density, 5 * density}, 0));
            canvas.drawLine(marker.x, top, marker.x, bottom, paint);
            paint.setPathEffect(null);
            paint.setStyle(Paint.Style.FILL);
        }

        for (EvaluationPoint point : points) {
            PointF center = position(point, point.score == null ? 0 : point.score, range, lastPly, left, top, width, height);
            boolean current = point.ply == displayedPly;
            float radius = (current ? 5.5f : 3f) * density;
            if (current) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(4 * density);
                paint.setColor(Color.argb(70, 24, 126, 80));
                canvas.drawCircle(center.x, center.y, radius + 3 * density, paint);
                paint.setStyle(Paint.Style.FILL);
            }
            if (point.score == null) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.rgb(250, 248, 241));
                canvas.drawCircle(center.x, center.y, radius, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.5f * density);
                paint.setColor(MUTED);
                canvas.drawCircle(center.x, center.y, radius, paint);
                paint.setStyle(Paint.Style.FILL);
            } else {
                paint.setColor(current ? GREEN : point.score >= 0 ? RED : BLACK);
                canvas.drawCircle(center.x, center.y, radius, paint);
            }
        }

        if (scores.isEmpty()) {
            paint.setColor(MUTED);
            paint.setTextSize(13 * density);
            paint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(controller.analyzing ? "正在计算首个局面评分…" : "落子后将在这里生成评分曲线",
                    (left + right) / 2f, (top + bottom) / 2f, paint);
        } else if (controller.analyzing && controller.activePly < points.size() && points.get(controller.activePly).score == null) {
            paint.setColor(MUTED);
            paint.setTextSize(11 * density);
            paint.setTextAlign(Paint.Align.RIGHT);
            canvas.drawText("当前点计算中…", right, top + 11 * density, paint);
        }
        if (scrubPly != null) drawMiniBoard(canvas, scrubPly, points);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (controller == null) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                getParent().requestDisallowInterceptTouchEvent(true);
                updateScrub(event.getX());
                return true;
            case MotionEvent.ACTION_MOVE:
                updateScrub(event.getX());
                return true;
            case MotionEvent.ACTION_UP:
                int target = plyAt(event.getX());
                scrubPly = null;
                if (boardView != null) boardView.setTimelinePreview(null);
                getParent().requestDisallowInterceptTouchEvent(false);
                invalidate();
                performClick();
                controller.goToPly(target);
                return true;
            case MotionEvent.ACTION_CANCEL:
                scrubPly = null;
                if (boardView != null) boardView.setTimelinePreview(null);
                getParent().requestDisallowInterceptTouchEvent(false);
                invalidate();
                return false;
            default:
                return super.onTouchEvent(event);
        }
    }

    private void updateScrub(float touchX) {
        int ply = plyAt(touchX);
        if (scrubPly != null && scrubPly == ply) return;
        scrubPly = ply;
        if (boardView != null) boardView.setTimelinePreview(ply);
        invalidate();
    }

    private int plyAt(float touchX) {
        List<EvaluationPoint> points = controller.evaluationPoints();
        int lastPly = points.isEmpty() ? 0 : points.get(points.size() - 1).ply;
        float left = 48 * density;
        float right = getWidth() - 10 * density;
        float ratio = Math.max(0f, Math.min(1f, (touchX - left) / Math.max(1f, right - left)));
        return Math.round(ratio * lastPly);
    }

    @Override public boolean performClick() {
        super.performClick();
        return true;
    }

    private PointF position(EvaluationPoint point, int score, int range, int lastPly,
                            float left, float top, float width, float height) {
        int clamped = Math.max(-range, Math.min(range, score));
        return new PointF(left + point.ply / (float) lastPly * width,
                top + height / 2f - clamped / (float) range * height / 2f);
    }

    private void drawSegment(Canvas canvas, PointF start, int startScore, PointF end, int endScore) {
        if ((startScore >= 0) == (endScore >= 0) || startScore == endScore) {
            stroke(canvas, start, end, startScore + endScore >= 0 ? RED : BLACK);
            return;
        }
        float ratio = Math.abs(startScore) / (float) (Math.abs(startScore) + Math.abs(endScore));
        PointF crossing = new PointF(start.x + (end.x - start.x) * ratio,
                start.y + (end.y - start.y) * ratio);
        stroke(canvas, start, crossing, startScore >= 0 ? RED : BLACK);
        stroke(canvas, crossing, end, endScore >= 0 ? RED : BLACK);
    }

    private void stroke(Canvas canvas, PointF start, PointF end, int color) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(3 * density);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setColor(color);
        Path path = new Path();
        path.moveTo(start.x, start.y);
        path.lineTo(end.x, end.y);
        canvas.drawPath(path, paint);
        paint.setStyle(Paint.Style.FILL);
    }

    private void drawMiniBoard(Canvas canvas, int ply, List<EvaluationPoint> points) {
        float boardWidth = 96 * density;
        float boardHeight = 116 * density;
        float right = getWidth() - 8 * density;
        float left = right - boardWidth;
        float top = 6 * density;
        float cardBottom = top + boardHeight + 34 * density;
        paint.setColor(Color.argb(242, 255, 253, 248));
        canvas.drawRoundRect(left - 7 * density, top - 4 * density, right + 3 * density, cardBottom,
                8 * density, 8 * density, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(density);
        paint.setColor(Color.argb(65, 30, 30, 25));
        canvas.drawRoundRect(left - 7 * density, top - 4 * density, right + 3 * density, cardBottom,
                8 * density, 8 * density, paint);

        float inset = 5 * density;
        float cell = Math.min((boardWidth - inset * 2) / 8f, (boardHeight - inset * 2) / 9f);
        float originX = left + (boardWidth - cell * 8) / 2f;
        float originY = top + (boardHeight - cell * 9) / 2f;
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(224, 184, 122));
        canvas.drawRoundRect(left, top, right, top + boardHeight, 5 * density, 5 * density, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(0.7f * density);
        paint.setColor(Color.argb(115, 50, 40, 27));
        for (int rank = 0; rank <= 9; rank++) {
            float y = originY + rank * cell;
            canvas.drawLine(originX, y, originX + cell * 8, y, paint);
        }
        for (int file = 0; file <= 8; file++) {
            float x = originX + file * cell;
            canvas.drawLine(x, originY, x, originY + cell * 9, paint);
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(224, 184, 122));
        canvas.drawRect(originX, originY + cell * 4, originX + cell * 8, originY + cell * 5, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setColor(Color.argb(115, 50, 40, 27));
        canvas.drawRect(originX, originY + cell * 4, originX + cell * 8, originY + cell * 5, paint);

        for (BoardPiece piece : controller.piecesAtPly(ply)) {
            int displayFile = controller.boardFlipped ? 8 - piece.file : piece.file;
            int displayRank = controller.boardFlipped ? 9 - piece.rank : piece.rank;
            float x = originX + displayFile * cell;
            float y = originY + displayRank * cell;
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(247, 220, 170));
            canvas.drawCircle(x, y, cell * 0.36f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(0.8f * density);
            paint.setColor(piece.side == Side.RED ? RED : BLACK);
            canvas.drawCircle(x, y, cell * 0.36f, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(android.graphics.Typeface.create("serif", android.graphics.Typeface.BOLD));
            paint.setTextSize(cell * 0.43f);
            canvas.drawText(piece.name(), x, y - (paint.ascent() + paint.descent()) / 2f, paint);
        }

        paint.setStyle(Paint.Style.FILL);
        paint.setColor(GREEN);
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.BOLD));
        paint.setTextSize(10 * density);
        canvas.drawText(ply == 0 ? "开局" : "第 " + ply + " 步后", left, top + boardHeight + 14 * density, paint);
        Integer score = null;
        for (EvaluationPoint point : points) if (point.ply == ply) { score = point.score; break; }
        paint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL));
        paint.setTextSize(9 * density);
        paint.setColor(MUTED);
        String scoreText = score == null ? "暂无评分" : String.format(Locale.CHINA, "红方视角 %+.2f", score / 100.0);
        canvas.drawText(scoreText, left, top + boardHeight + 28 * density, paint);
        paint.setStyle(Paint.Style.FILL);
    }
}
