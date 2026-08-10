package com.yisi.xiangqicoach;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class MainActivity extends Activity implements CoachController.Listener {
    private static final int PAPER = Color.rgb(248, 245, 234);
    private static final int INK = Color.rgb(26, 31, 26);
    private static final int GREEN = Color.rgb(23, 87, 64);
    private static final int RED = Color.rgb(186, 43, 33);
    private static final int MUTED = Color.rgb(125, 125, 120);

    private CoachController controller;
    private ScrollView rootScroll;
    private TextView engineStatus;
    private TextView sideText;
    private TextView boardHint;
    private TextView bestToggle;
    private Button undoButton;
    private XiangqiBoardView boardView;
    private SituationChartView situationChartView;
    private LinearLayout reviewBox;
    private TextView reviewTag, reviewTitle, reviewSummary, reviewDetail;
    private TextView globalBest;
    private TextView candidateTitle;
    private LinearLayout candidateList;
    private TextView roundCount, qualityText, historyText;
    private TextView situationPerspective;
    private LinearLayout setupPanel;
    private TextView humanSideButton;
    private final Map<GameMode, TextView> modeButtons = new HashMap<>();
    private final Map<Integer, TextView> depthButtons = new HashMap<>();
    private final Handler tapHandler = new Handler(Looper.getMainLooper());

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(PAPER);
        window.setNavigationBarColor(PAPER);
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        controller = new CoachController(this);
        controller.setListener(this);
        setContentView(buildContent());
        controller.start();
    }

    @Override protected void onDestroy() {
        tapHandler.removeCallbacksAndMessages(null);
        boardView.stopVariation();
        controller.close();
        super.onDestroy();
    }

    @Override public void onStateChanged() { updateUi(); }

    private View buildContent() {
        ScrollView scroll = new ScrollView(this);
        rootScroll = scroll;
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(PAPER);
        LinearLayout root = column();
        root.setPadding(dp(14), dp(16), dp(14), dp(28));
        scroll.addView(root, matchWrap());

        root.addView(buildHeader(), matchWrapBottom(18));
        root.addView(buildBoardSection(), matchWrapBottom(18));
        root.addView(buildAnalysisCard(), matchWrapBottom(18));
        root.addView(buildSituationCard(), matchWrapBottom(18));
        root.addView(buildDepthCard(), matchWrapBottom(16));
        root.addView(buildFooter(), matchWrap());
        return scroll;
    }

    private View buildHeader() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        TextView icon = label("象", 25, Color.WHITE, Typeface.BOLD);
        icon.setGravity(Gravity.CENTER);
        icon.setBackground(round(RED, 10, 0, Color.TRANSPARENT));
        row.addView(icon, new LinearLayout.LayoutParams(dp(48), dp(48)));

        LinearLayout titles = column();
        titles.setPadding(dp(12), 0, 0, 0);
        TextView name = label("弈思", 22, INK, Typeface.BOLD);
        TextView subtitle = label("象棋思考教练 · Android", 12, MUTED, Typeface.NORMAL);
        titles.addView(name);
        titles.addView(subtitle);
        row.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        engineStatus = label("● 本地皮卡鱼计算中", 12, GREEN, Typeface.BOLD);
        engineStatus.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        row.addView(engineStatus, wrapWrap());
        return row;
    }

    private View buildDepthCard() {
        LinearLayout card = card();
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.addView(label("思考深度", 15, INK, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        heading.addView(label("越高越慢，棋力越强", 11, MUTED, Typeface.NORMAL));
        card.addView(heading, matchWrapBottom(10));

        LinearLayout choices = new LinearLayout(this);
        choices.setOrientation(LinearLayout.HORIZONTAL);
        for (int depth : CoachController.AVAILABLE_DEPTHS) {
            TextView button = label(String.valueOf(depth), 14, INK, Typeface.BOLD);
            button.setGravity(Gravity.CENTER);
            button.setContentDescription("思考深度 " + depth);
            button.setOnClickListener(view -> controller.setDepth(depth));
            depthButtons.put(depth, button);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(40), 1);
            if (depth != CoachController.AVAILABLE_DEPTHS.get(0)) params.setMarginStart(dp(6));
            choices.addView(button, params);
        }
        card.addView(choices, matchWrap());
        return card;
    }

    private View buildBoardSection() {
        LinearLayout section = column();
        section.addView(buildModeControls(), matchWrapBottom(8));
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);

        sideText = label("● 红方走棋", 18, RED, Typeface.BOLD);
        toolbar.addView(sideText, new LinearLayout.LayoutParams(0, dp(46), 1));

        bestToggle = label("优", 18, GREEN, Typeface.BOLD);
        bestToggle.setGravity(Gravity.CENTER);
        bestToggle.setContentDescription("显示全局候选箭头");
        bestToggle.setOnClickListener(view -> controller.toggleBestArrows());
        toolbar.addView(bestToggle, new LinearLayout.LayoutParams(dp(42), dp(42)));

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        Button perspective = smallButton("⇅", view -> controller.toggleBoardPerspective());
        perspective.setContentDescription("切换红黑视角");
        undoButton = smallButton("↶ 悔棋", view -> controller.undo());
        Button reset = smallButton("↻ 重开", view -> controller.reset());
        controls.addView(perspective, wrapWrap());
        controls.addView(undoButton, wrapWrap());
        controls.addView(reset, wrapWrap());
        toolbar.addView(controls, new LinearLayout.LayoutParams(0, dp(46), 1));
        section.addView(toolbar, matchWrapBottom(6));

        boardView = new XiangqiBoardView(this);
        boardView.setController(controller);
        section.addView(boardView, matchWrapBottom(8));
        setupPanel = buildSetupPanel();
        section.addView(setupPanel, matchWrapBottom(8));
        boardHint = label("● 点击本方棋子开始；候选着法可双击直接落子", 12, MUTED, Typeface.NORMAL);
        boardHint.setGravity(Gravity.CENTER);
        section.addView(boardHint, matchWrap());
        return section;
    }

    private View buildModeControls() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        for (GameMode mode : GameMode.values()) {
            String title = mode == GameMode.LOCAL ? "双人对弈" : mode == GameMode.COMPUTER ? "人机对战" : "摆盘";
            TextView button = label(title, 12, INK, Typeface.BOLD);
            button.setGravity(Gravity.CENTER);
            button.setOnClickListener(view -> controller.setGameMode(mode));
            modeButtons.put(mode, button);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(38), 1);
            if (mode != GameMode.LOCAL) params.setMarginStart(dp(5));
            row.addView(button, params);
        }
        humanSideButton = label("执红", 12, RED, Typeface.BOLD);
        humanSideButton.setGravity(Gravity.CENTER);
        humanSideButton.setOnClickListener(view -> controller.setHumanSide(controller.humanSide == Side.RED ? Side.BLACK : Side.RED));
        LinearLayout.LayoutParams sideParams = new LinearLayout.LayoutParams(dp(54), dp(38)); sideParams.setMarginStart(dp(5));
        row.addView(humanSideButton, sideParams);
        return row;
    }

    private LinearLayout buildSetupPanel() {
        LinearLayout panel = column();
        panel.setPadding(dp(10), dp(10), dp(10), dp(10));
        panel.setBackground(round(withAlpha(Color.WHITE, 160), 8, dp(1), withAlpha(INK, 30)));
        LinearLayout actions = new LinearLayout(this); actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.addView(smallButton("移动", view -> controller.setSetupAction(SetupAction.MOVE)), new LinearLayout.LayoutParams(0, dp(40), 1));
        actions.addView(smallButton("删除", view -> controller.setSetupAction(SetupAction.ERASE)), new LinearLayout.LayoutParams(0, dp(40), 1));
        actions.addView(smallButton("先行方", view -> controller.toggleSetupSide()), new LinearLayout.LayoutParams(0, dp(40), 1));
        actions.addView(smallButton("完成摆盘", view -> controller.finishSetup()), new LinearLayout.LayoutParams(0, dp(40), 1));
        panel.addView(actions, matchWrapBottom(7));
        panel.addView(buildPiecePalette(Side.RED), matchWrapBottom(6));
        panel.addView(buildPiecePalette(Side.BLACK), matchWrap());
        return panel;
    }

    private View buildPiecePalette(Side side) {
        HorizontalScrollView scroll = new HorizontalScrollView(this); scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); row.setGravity(Gravity.CENTER_VERTICAL);
        row.addView(label(side.title(), 11, MUTED, Typeface.BOLD), new LinearLayout.LayoutParams(dp(40), dp(36)));
        PieceKind[] kinds = {PieceKind.ROOK, PieceKind.HORSE, PieceKind.ELEPHANT, PieceKind.ADVISOR, PieceKind.KING, PieceKind.CANNON, PieceKind.PAWN};
        for (PieceKind kind : kinds) {
            String name = new BoardPiece(side, kind, 0, 0).name();
            Button button = smallButton(name, view -> controller.setSetupPiece(side, kind));
            button.setTextColor(side == Side.RED ? RED : INK);
            row.addView(button, new LinearLayout.LayoutParams(dp(42), dp(36)));
        }
        scroll.addView(row, wrapWrap());
        return scroll;
    }

    private View buildAnalysisCard() {
        LinearLayout card = card();
        LinearLayout title = new LinearLayout(this);
        title.setOrientation(LinearLayout.HORIZONTAL);
        title.setGravity(Gravity.CENTER_VERTICAL);
        TextView number = label("01", 25, Color.rgb(169, 149, 112), Typeface.BOLD);
        title.addView(number, wrapWrap());
        LinearLayout names = column();
        names.setPadding(dp(10), 0, 0, 0);
        names.addView(label("教练分析", 19, INK, Typeface.BOLD));
        TextView english = label("COACH REVIEW", 11, MUTED, Typeface.NORMAL);
        english.setLetterSpacing(0.12f);
        names.addView(english);
        title.addView(names, wrapWrap());
        card.addView(title, matchWrapBottom(14));

        reviewBox = column();
        reviewBox.setPadding(dp(12), dp(12), dp(12), dp(12));
        reviewBox.setBackground(round(Color.rgb(237, 245, 239), 8, 0, Color.TRANSPARENT));
        LinearLayout reviewHeading = new LinearLayout(this);
        reviewHeading.setOrientation(LinearLayout.HORIZONTAL);
        reviewHeading.setGravity(Gravity.CENTER_VERTICAL);
        reviewTag = label("待走", 11, Color.WHITE, Typeface.BOLD);
        reviewTag.setGravity(Gravity.CENTER);
        reviewTag.setPadding(dp(7), dp(4), dp(7), dp(4));
        reviewTag.setBackground(round(GREEN, 2, 0, Color.TRANSPARENT));
        reviewHeading.addView(reviewTag, wrapWrap());
        reviewTitle = label("等待落子", 17, INK, Typeface.BOLD);
        reviewTitle.setPadding(dp(10), 0, 0, 0);
        reviewHeading.addView(reviewTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        reviewBox.addView(reviewHeading, matchWrapBottom(7));
        reviewSummary = label("先形成判断，再用引擎验证。", 14, INK, Typeface.BOLD);
        reviewBox.addView(reviewSummary, matchWrapBottom(4));
        reviewDetail = label("点击棋子可查看合法落点和皮卡鱼首选。", 12, MUTED, Typeface.NORMAL);
        reviewBox.addView(reviewDetail, matchWrap());
        card.addView(reviewBox, matchWrapBottom(12));

        globalBest = label("全局最优着法\n正在计算…", 15, INK, Typeface.BOLD);
        globalBest.setPadding(dp(11), dp(10), dp(11), dp(10));
        globalBest.setBackground(round(Color.TRANSPARENT, 7, dp(1), withAlpha(RED, 70)));
        card.addView(globalBest, matchWrapBottom(12));

        View divider = new View(this);
        divider.setBackgroundColor(withAlpha(INK, 28));
        card.addView(divider, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        candidateTitle = label("全局候选着法 · 单击动画演示 · 双击落子", 12, MUTED, Typeface.BOLD);
        candidateTitle.setPadding(0, dp(12), 0, dp(8));
        card.addView(candidateTitle, matchWrap());
        candidateList = column();
        card.addView(candidateList, matchWrap());
        return card;
    }

    private View buildFooter() {
        LinearLayout footer = card();
        LinearLayout stats = new LinearLayout(this);
        stats.setOrientation(LinearLayout.HORIZONTAL);
        stats.setGravity(Gravity.CENTER_VERTICAL);

        LinearLayout rounds = column();
        roundCount = label("0", 27, INK, Typeface.BOLD);
        rounds.addView(roundCount);
        rounds.addView(label("已走回合", 11, MUTED, Typeface.NORMAL));
        stats.addView(rounds, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        LinearLayout quality = column();
        qualityText = label("—", 18, INK, Typeface.BOLD);
        quality.addView(qualityText);
        quality.addView(label("本步质量", 11, MUTED, Typeface.NORMAL));
        stats.addView(quality, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView rule = label("双方各走一步计 1 回合", 11, MUTED, Typeface.NORMAL);
        rule.setGravity(Gravity.END);
        stats.addView(rule, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        footer.addView(stats, matchWrapBottom(8));

        HorizontalScrollView historyScroll = new HorizontalScrollView(this);
        historyScroll.setHorizontalScrollBarEnabled(false);
        historyText = label("", 12, INK, Typeface.BOLD);
        historyScroll.addView(historyText, wrapWrap());
        footer.addView(historyScroll, matchWrap());
        return footer;
    }

    private View buildSituationCard() {
        LinearLayout card = card();
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.addView(label("02", 25, Color.rgb(169, 149, 112), Typeface.BOLD), wrapWrap());
        LinearLayout names = column();
        names.setPadding(dp(10), 0, 0, 0);
        names.addView(label("局势图", 19, INK, Typeface.BOLD));
        TextView english = label("POSITION TREND", 11, MUTED, Typeface.NORMAL);
        english.setLetterSpacing(0.12f);
        names.addView(english);
        heading.addView(names, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        situationPerspective = label("正在查看：开局 · 红方视角", 11, MUTED, Typeface.NORMAL);
        situationPerspective.setGravity(Gravity.END);
        heading.addView(situationPerspective, wrapWrap());
        card.addView(heading, matchWrapBottom(8));
        TextView help = label("在曲线上按住滑移可快速预览棋盘，松手到达该步；在历史局面落子会创建新分支。", 12, MUTED, Typeface.NORMAL);
        card.addView(help, matchWrapBottom(4));
        situationChartView = new SituationChartView(this);
        situationChartView.setController(controller);
        situationChartView.setBoardView(boardView);
        card.addView(situationChartView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(245)));
        return card;
    }

    private void updateUi() {
        boolean hasError = controller.errorMessage != null;
        engineStatus.setText(controller.gameMode == GameMode.SETUP ? "● 摆盘模式" : controller.gameMode == GameMode.COMPUTER && !controller.canHumanMove() ? "● 电脑正在思考" : hasError ? "● 引擎暂不可用" : controller.analyzing ? "● 本地皮卡鱼计算中" : "● 本地皮卡鱼已就绪 · " + controller.currentScore());
        engineStatus.setTextColor(hasError ? RED : controller.analyzing ? Color.rgb(218, 132, 37) : GREEN);
        sideText.setText("● " + controller.sideToMove().title() + "走棋");
        sideText.setTextColor(controller.sideToMove() == Side.RED ? RED : INK);
        for (Map.Entry<GameMode, TextView> entry : modeButtons.entrySet()) {
            boolean selectedMode = entry.getKey() == controller.gameMode;
            entry.getValue().setTextColor(selectedMode ? Color.WHITE : INK);
            entry.getValue().setBackground(round(selectedMode ? GREEN : withAlpha(Color.WHITE, 130), 7, dp(1), selectedMode ? GREEN : withAlpha(INK, 30)));
        }
        humanSideButton.setVisibility(controller.gameMode == GameMode.COMPUTER ? View.VISIBLE : View.GONE);
        humanSideButton.setText(controller.humanSide == Side.RED ? "执红" : "执黑");
        setupPanel.setVisibility(controller.gameMode == GameMode.SETUP ? View.VISIBLE : View.GONE);

        for (Map.Entry<Integer, TextView> entry : depthButtons.entrySet()) {
            boolean selected = entry.getKey() == controller.analysisDepth;
            entry.getValue().setTextColor(selected ? Color.WHITE : INK);
            entry.getValue().setBackground(round(selected ? GREEN : withAlpha(Color.WHITE, 125), 8,
                    dp(1), selected ? GREEN : withAlpha(INK, 35)));
        }

        bestToggle.setTextColor(controller.showBestArrows ? Color.WHITE : GREEN);
        bestToggle.setBackground(round(controller.showBestArrows ? GREEN : withAlpha(Color.WHITE, 145), 100,
                dp(1), withAlpha(GREEN, 130)));
        undoButton.setEnabled(controller.activePly > 0);
        undoButton.setAlpha(controller.activePly > 0 ? 1f : 0.35f);
        situationPerspective.setText("正在查看：" + (controller.activePly == 0 ? "开局" : "第 " + controller.activePly + " 步后") + " · 红方视角");
        boardView.invalidate();
        situationChartView.invalidate();

        BoardPiece selected = controller.selectedPiece();
        if (controller.gameMode == GameMode.SETUP) {
            boardHint.setText("● 摆盘模式 · " + (controller.setupAction == SetupAction.MOVE ? "点击棋子后再点目标位置" : controller.setupAction == SetupAction.ERASE ? "点击棋子删除" : "点击棋盘放置" + new BoardPiece(controller.setupSide, controller.setupKind, 0, 0).name()) + (controller.setupMessage == null ? "" : " · " + controller.setupMessage));
        } else if (controller.gameMode == GameMode.COMPUTER && !controller.canHumanMove()) {
            boardHint.setText("● 电脑正在计算并将自动走出首选着法");
        }
        if (selected != null && controller.gameMode != GameMode.SETUP && !(controller.gameMode == GameMode.COMPUTER && !controller.canHumanMove())) {
            boardHint.setText(controller.analyzingSelection
                    ? "● 已选中" + selected.name() + "：蓝色为合法落点，正在计算绿色首选"
                    : "● 已选中" + selected.name() + "：绿色为本子首选，蓝色为其他合法落点");
            reviewTag.setText(controller.analyzingSelection ? "分析中" : controller.selectedIsGlobalBest() ? "全局最优" : "本子首选");
            reviewTitle.setText(selected.name() + "怎么走");
            if (controller.selectedLines.isEmpty()) reviewSummary.setText("正在比较这枚棋子的合法着法…");
            else reviewSummary.setText(coloredMoveText("", controller.notation(controller.selectedLines.get(0)), " · 走后评分 " + controller.scoreText(controller.selectedLines.get(0)), controller.sideToMove()));
            reviewDetail.setText(controller.selectedIsGlobalBest()
                    ? "这枚棋子的首选与全局第一候选评分相同，属于全局最优着法。"
                    : "共 " + controller.selectedLegalMoves().size() + " 个合法落点。绿色表示本子首选；当前评分低于全局首选。");
        } else if (controller.gameMode != GameMode.SETUP && !(controller.gameMode == GameMode.COMPUTER && !controller.canHumanMove())) {
            boardHint.setText(controller.activePly < controller.history.size()
                    ? "● 正在查看第 " + controller.activePly + " 步后的历史局面；现在落子会替换后续 " + (controller.history.size() - controller.activePly) + " 步"
                    : controller.legalMoves.isEmpty() && controller.analyzing
                    ? "● 正在生成合法着法…"
                    : "● 思考中仍可行棋；候选着法可双击直接落子");
            CoachController.Review review = controller.review();
            reviewTag.setText(review.grade);
            MoveRecord activeMove = controller.activeMove();
            reviewTitle.setText(activeMove == null ? "等待落子" : coloredMoveText("", activeMove.notation, "", activeMove.mover));
            reviewSummary.setText(review.summary);
            reviewDetail.setText(review.detail);
        }

        if (hasError) {
            globalBest.setText("皮卡鱼计算失败\n" + controller.errorMessage + "\n本次不显示推测性评分");
        } else if (controller.globalLines.isEmpty()) {
            globalBest.setText("全局最优着法\n正在计算…");
        } else {
            EngineLine best = controller.globalLines.get(0);
            globalBest.setText(coloredMoveText("全局最优着法\n", controller.notation(best), "    最佳\n走后评分 " + controller.scoreText(best) + " · 深度 " + best.depth, controller.sideToMove()));
            installCandidateTap(globalBest, best);
        }

        candidateTitle.setText(selected == null ? "全局候选着法 · 单击动画演示 · 双击落子" : "这枚棋子的候选 · 单击动画演示 · 双击落子");
        renderCandidates(selected == null ? controller.globalLines : controller.selectedLines, selected != null);
        roundCount.setText(String.valueOf(controller.completedRounds()));
        qualityText.setText(controller.activePly == 0 ? "—" : controller.review().grade);
        renderHistory();
    }

    private void renderCandidates(List<EngineLine> lines, boolean selectedScope) {
        candidateList.removeAllViews();
        boolean waiting = selectedScope ? controller.analyzingSelection : controller.analyzing;
        if (waiting) {
            TextView progress = label("深度 " + controller.analysisDepth + " 计算中…（棋盘仍可操作）", 13, MUTED, Typeface.NORMAL);
            progress.setPadding(dp(8), dp(10), dp(8), dp(10));
            candidateList.addView(progress, matchWrapBottom(6));
        }
        for (int index = 0; index < lines.size(); index++) {
            EngineLine line = lines.get(index);
            String quality = selectedScope ? (index == 0 ? "本子最佳" : "可行") : controller.quality(line, index);
            String nodes = line.nodes >= 1_000_000
                    ? String.format(Locale.CHINA, "%.1fM", line.nodes / 1_000_000.0)
                    : line.nodes >= 1_000 ? String.format(Locale.CHINA, "%.0fK", line.nodes / 1_000.0) : String.valueOf(line.nodes);
            TextView row = label("", 13, INK, Typeface.BOLD);
            row.setText(coloredMoveText((index + 1) + "    ", controller.notation(line), "                    " + quality
                    + "\n      " + (index == 0 ? "皮卡鱼首选" : "深度 " + line.depth + " · " + nodes + " 节点")
                    + "                          走后 " + controller.scoreText(line), controller.sideToMove()));
            row.setLineSpacing(dp(2), 1f);
            row.setPadding(dp(10), dp(9), dp(10), dp(9));
            boolean highlighted = controller.previewedCandidateMove == null
                    ? index == 0
                    : controller.previewedCandidateMove.equals(line.firstMove());
            row.setBackground(round(highlighted ? Color.rgb(232, 244, 235) : withAlpha(Color.WHITE, 120), 7,
                    highlighted ? dp(2) : dp(1), highlighted ? withAlpha(GREEN, 160) : withAlpha(INK, 25)));
            installCandidateTap(row, line);
            candidateList.addView(row, matchWrapBottom(7));
        }
    }

    private void renderHistory() {
        SpannableStringBuilder text = new SpannableStringBuilder();
        for (int index = 0; index < controller.history.size(); index++) {
            MoveRecord record = controller.history.get(index);
            if (index > 0) text.append("     ");
            text.append(String.valueOf(index / 2 + 1)).append(record.mover == Side.RED ? ". " : "… ");
            int moveStart = text.length();
            text.append(record.notation);
            text.setSpan(new ForegroundColorSpan(moveColor(record.mover)), moveStart, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        historyText.setText(text.toString());
        historyText.setVisibility(controller.history.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private int moveColor(Side side) { return side == Side.RED ? RED : INK; }

    private CharSequence coloredMoveText(String prefix, String notation, String suffix, Side side) {
        SpannableStringBuilder text = new SpannableStringBuilder(prefix).append(notation).append(suffix);
        text.setSpan(new ForegroundColorSpan(moveColor(side)), prefix.length(), prefix.length() + notation.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return text;
    }

    private void installCandidateTap(View view, EngineLine line) {
        view.setTag(R.id.double_tap_time, 0L);
        view.setOnClickListener(clicked -> {
            long now = SystemClock.elapsedRealtime();
            Object stored = clicked.getTag(R.id.double_tap_time);
            long last = stored instanceof Long ? (Long) stored : 0L;
            if (now - last < 420) {
                Object pending = clicked.getTag(R.id.single_tap_action);
                if (pending instanceof Runnable) tapHandler.removeCallbacks((Runnable) pending);
                clicked.setTag(R.id.double_tap_time, 0L);
                clicked.setTag(R.id.single_tap_action, null);
                boardView.stopVariation();
                if (controller.canHumanMove()) controller.play(line.firstMove());
            } else {
                clicked.setTag(R.id.double_tap_time, now);
                Runnable pending = () -> {
                    clicked.setTag(R.id.double_tap_time, 0L);
                    clicked.setTag(R.id.single_tap_action, null);
                    controller.previewedCandidateMove = line.firstMove();
                    updateUi();
                    boardView.startVariation(line);
                    focusBoard();
                };
                clicked.setTag(R.id.single_tap_action, pending);
                tapHandler.postDelayed(pending, 430);
            }
        });
    }

    private void focusBoard() {
        if (rootScroll == null || boardView == null) return;
        boardView.post(() -> {
            Rect rect = new Rect();
            boardView.getDrawingRect(rect);
            rootScroll.offsetDescendantRectToMyCoords(boardView, rect);
            rootScroll.smoothScrollTo(0, Math.max(0, rect.top - dp(12)));
        });
    }

    private LinearLayout card() {
        LinearLayout card = column();
        card.setPadding(dp(16), dp(15), dp(16), dp(15));
        card.setBackground(round(withAlpha(Color.WHITE, 180), 11, dp(1), withAlpha(INK, 18)));
        return card;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private TextView label(String value, float sp, int color, int style) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(sp);
        text.setTextColor(color);
        text.setTypeface(Typeface.create("sans", style));
        text.setIncludeFontPadding(false);
        return text;
    }

    private Button smallButton(String value, View.OnClickListener action) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(13);
        button.setTextColor(Color.rgb(20, 112, 225));
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(7), 0, dp(7), 0);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setOnClickListener(action);
        return button;
    }

    private GradientDrawable round(int fill, float radiusDp, int strokeWidth, int strokeColor) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeWidth > 0) drawable.setStroke(strokeWidth, strokeColor);
        return drawable;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams matchWrapBottom(int bottomDp) {
        LinearLayout.LayoutParams params = matchWrap();
        params.bottomMargin = dp(bottomDp);
        return params;
    }

    private LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private int withAlpha(int color, int alpha) { return (color & 0x00FFFFFF) | (alpha << 24); }
}
