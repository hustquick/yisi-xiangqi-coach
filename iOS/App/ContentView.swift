import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @StateObject private var viewModel = CoachViewModel()
    @State private var boardFocusRequest = 0
    @State private var showsRecordSheet = false
    @State private var importsFile = false
    @State private var fenText = ""
    @State private var analysisExpanded = true
    @State private var situationExpanded = false
    @State private var recordsExpanded = false
    @State private var depthExpanded = false

    private let paper = Color(red: 0.97, green: 0.96, blue: 0.92)
    private let ink = Color(red: 0.10, green: 0.12, blue: 0.10)
    private let green = Color(red: 0.09, green: 0.34, blue: 0.25)
    private let red = Color(red: 0.73, green: 0.17, blue: 0.13)

    var body: some View {
        GeometryReader { geometry in
            ScrollViewReader { proxy in
                Group {
                    if geometry.size.width >= 820 {
                        if geometry.size.height > geometry.size.width {
                            iPadPortraitLayout(size: geometry.size)
                        } else {
                            iPadLandscapeLayout(size: geometry.size)
                        }
                    } else {
                        phoneLayout
                    }
                }
                .onChange(of: boardFocusRequest) { _, _ in
                    withAnimation(.easeInOut(duration: 0.38)) {
                        proxy.scrollTo("coach-board", anchor: .top)
                    }
                }
            }
            .background(paper.ignoresSafeArea())
        }
        .task { viewModel.start() }
        .fileImporter(isPresented: $importsFile, allowedContentTypes: [.data, .plainText, .json]) { result in
            if case .success(let url) = result {
                let accessed = url.startAccessingSecurityScopedResource()
                viewModel.importFile(url: url)
                if accessed { url.stopAccessingSecurityScopedResource() }
            }
        }
        .sheet(isPresented: $showsRecordSheet) { recordSheet }
        .alert("棋谱", isPresented: Binding(get: { viewModel.recordMessage != nil }, set: { if !$0 { viewModel.dismissRecordMessage() } })) {
            Button("好") { viewModel.dismissRecordMessage() }
        } message: { Text(viewModel.recordMessage ?? "") }
        .alert(viewModel.gameOutcome?.title ?? "对局结束", isPresented: $viewModel.isShowingGameOutcome) {
            Button("再来一局") { viewModel.reset() }
            Button("查看棋局", role: .cancel) {}
        } message: { Text(viewModel.gameOutcome?.detail ?? "") }
    }

    private var phoneLayout: some View {
        ScrollView {
            VStack(spacing: 18) {
                header
                boardSection
                collapsible("教练分析", isExpanded: $analysisExpanded) { analysisPanel }
                collapsible("局势图", isExpanded: $situationExpanded) { situationPanel }
                collapsible("棋谱与存档", isExpanded: $recordsExpanded) { recordToolbar }
                collapsible("分析深度", isExpanded: $depthExpanded) { depthSelector }
                footer
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
        }
    }

    private func iPadPortraitLayout(size: CGSize) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                header
                boardSection
                    .frame(maxWidth: min(760, size.width - 48, (size.height - 120) * 0.77))
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 14) {
                    collapsible("教练分析", isExpanded: $analysisExpanded) { analysisPanel }
                    collapsible("局势图", isExpanded: $situationExpanded) { situationPanel }
                    collapsible("棋谱与存档", isExpanded: $recordsExpanded) { recordToolbar }
                    collapsible("分析深度", isExpanded: $depthExpanded) { depthSelector }
                }
                footer
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 10)
        }
    }

    private func iPadLandscapeLayout(size: CGSize) -> some View {
        VStack(spacing: 12) {
            header.padding(.horizontal, 24)
            HStack(alignment: .top, spacing: 22) {
                VStack(spacing: 0) {
                    boardSection
                        .frame(maxWidth: min(650, size.width * 0.59, max(360, (size.height - 150) * 0.77)))
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)

                ScrollView {
                    LazyVStack(spacing: 14) {
                        collapsible("教练分析", isExpanded: $analysisExpanded) { analysisPanel }
                        collapsible("局势图", isExpanded: $situationExpanded) { situationPanel }
                        collapsible("棋谱与存档", isExpanded: $recordsExpanded) { recordToolbar }
                        collapsible("分析深度", isExpanded: $depthExpanded) { depthSelector }
                        footer
                    }
                    .padding(.trailing, 6)
                    .padding(.bottom, 24)
                }
                .frame(width: min(440, size.width * 0.38))
            }
            .padding(.horizontal, 24)
        }
        .padding(.top, 10)
    }

    private func collapsible<Content: View>(_ title: String, isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: isExpanded.wrappedValue ? 10 : 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.wrappedValue.toggle() }
            } label: {
                HStack {
                    Text(title).font(.subheadline.bold())
                    Spacer()
                    Image(systemName: isExpanded.wrappedValue ? "chevron.up.circle.fill" : "chevron.down.circle.fill")
                        .foregroundStyle(green)
                }
                .padding(.horizontal, 14).frame(height: 44)
                .background(.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            if isExpanded.wrappedValue { content() }
        }
    }

    private var recordToolbar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(viewModel.recordTitle).font(.subheadline.bold())
                Text("\(viewModel.activePly) / \(viewModel.history.count) 步").font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Button("|‹") { viewModel.goToPly(0) }.disabled(viewModel.activePly == 0)
            Button("‹") { viewModel.goToPly(viewModel.activePly - 1) }.disabled(viewModel.activePly == 0)
            Button("›") { viewModel.goToPly(viewModel.activePly + 1) }.disabled(viewModel.activePly == viewModel.history.count)
            Button("›|") { viewModel.goToPly(viewModel.history.count) }.disabled(viewModel.activePly == viewModel.history.count)
            Button("载入") { showsRecordSheet = true }
            Button("保存") { viewModel.saveGame() }.buttonStyle(.borderedProminent).tint(green)
        }
        .buttonStyle(.bordered)
        .padding(12).background(.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 10))
    }

    private var recordSheet: some View {
        NavigationStack {
            Form {
                Section("本地文件") { Button("选择 XQF、FEN 或弈思 JSON 文件") { importsFile = true } }
                Section("粘贴 FEN 局面") {
                    TextEditor(text: $fenText).frame(minHeight: 90).font(.system(.caption, design: .monospaced))
                    Button("载入此局面") { viewModel.importFEN(fenText); showsRecordSheet = false }.disabled(fenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Section("本机存档") {
                    if viewModel.savedGames.isEmpty { Text("还没有保存的棋局").foregroundStyle(.secondary) }
                    ForEach(viewModel.savedGames) { game in
                        Button { viewModel.loadSavedGame(game); showsRecordSheet = false } label: {
                            VStack(alignment: .leading) { Text(game.title); Text(game.savedAt.formatted()).font(.caption2).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
            .navigationTitle("载入棋谱或局面")
            .toolbar { Button("完成") { showsRecordSheet = false } }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("象")
                .font(.system(size: 24, weight: .bold, design: .serif))
                .foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(red, in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 1) {
                Text("弈思").font(.title3.bold())
                Text("象棋思考教练 · iOS").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 6) {
                Circle()
                    .fill(viewModel.errorMessage == nil
                          ? ((viewModel.isApplyingMove || viewModel.isAnalyzing) ? .orange : .green)
                          : .red)
                    .frame(width: 8, height: 8)
                Text(viewModel.errorMessage == nil
                     ? (viewModel.gameMode == .setup ? "摆盘模式 · 已暂停分析" : (viewModel.gameMode == .computer && !viewModel.canHumanMove ? "电脑正在思考应着" : (viewModel.isApplyingMove ? "正在落子" : (viewModel.isAnalyzing ? "本地皮卡鱼计算中" : "本地皮卡鱼已就绪 · \(viewModel.currentScore)"))))
                     : "引擎暂不可用")
                    .font(.caption.weight(.semibold))
            }
        }
        .foregroundStyle(ink)
    }

    private var depthSelector: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) {
                depthSelectorLabel
                depthPicker
            }
            VStack(alignment: .leading, spacing: 10) {
                depthSelectorLabel
                depthPicker
            }
        }
        .padding(14)
        .background(.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.08)))
    }

    private var depthSelectorLabel: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("分析深度").font(.subheadline.bold()).foregroundStyle(ink)
            Text("越深越准确，也需要更长时间").font(.caption).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var depthPicker: some View {
        Picker("分析深度", selection: Binding(
            get: { viewModel.analysisDepth },
            set: { viewModel.setAnalysisDepth($0) }
        )) {
            ForEach(CoachViewModel.availableDepths, id: \.self) { depth in
                Text("\(depth)").tag(depth)
            }
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 440)
    }

    private var boardSection: some View {
        VStack(spacing: 8) {
            gameModeControls
            HStack {
                    Label("\(viewModel.sideToMove.title)走棋", systemImage: "circle.fill")
                        .font(.headline)
                        .foregroundStyle(viewModel.sideToMove == .red ? red : ink)
                    Spacer()
                    Button { viewModel.toggleBoardPerspective() } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                    .accessibilityLabel(viewModel.boardFlipped ? "切换为红方视角" : "切换为黑方视角")
                    candidateArrowToggle
                    Button("悔棋", systemImage: "arrow.uturn.backward") { viewModel.undo() }
                        .disabled(viewModel.activePly == 0)
                    Button("重开", systemImage: "arrow.clockwise") { viewModel.reset() }
            }
            .buttonStyle(.borderless)
            XiangqiBoardView(viewModel: viewModel)
            if viewModel.gameMode == .setup { setupControls }
            HStack(spacing: 7) {
                Circle().fill(green).frame(width: 8, height: 8)
                Text(boardHint).font(.caption).foregroundStyle(.secondary)
            }
        }
        .id("coach-board")
    }

    private var gameModeControls: some View {
        VStack(spacing: 8) {
            Picker("对局模式", selection: Binding(get: { viewModel.gameMode }, set: { viewModel.setGameMode($0) })) {
                ForEach(GameMode.allCases) { mode in Text(mode.title).tag(mode) }
            }
            .pickerStyle(.segmented)
            if viewModel.gameMode == .computer {
                HStack {
                    Text("我方执棋").font(.caption).foregroundStyle(.secondary)
                    Picker("我方执棋", selection: Binding(get: { viewModel.humanSide }, set: { viewModel.setHumanSide($0) })) {
                        Text("红方").tag(XiangqiSide.red)
                        Text("黑方").tag(XiangqiSide.black)
                    }
                    .pickerStyle(.segmented).frame(maxWidth: 220)
                    Menu {
                        ForEach(ComputerLevel.all) { level in
                            Button("\(level.name) · Elo \(level.elo)") { viewModel.setComputerElo(level.elo) }
                        }
                    } label: {
                        Text(ComputerLevel.all.first(where: { $0.elo == viewModel.computerElo })?.name ?? "电脑等级")
                    }
                }
            }
        }
    }

    private var setupControls: some View {
        VStack(spacing: 9) {
            HStack {
                setupToolButton("移动", tool: .move)
                setupToolButton("删除", tool: .erase)
                Button(viewModel.sideToMove == .red ? "红方先行" : "黑方先行") { viewModel.toggleSetupSideToMove() }
                Spacer()
                Button("完成摆盘") { viewModel.finishSetup() }.buttonStyle(.borderedProminent).tint(green)
            }
            ForEach([XiangqiSide.red, .black], id: \.rawValue) { side in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Text(side.title).font(.caption).foregroundStyle(.secondary)
                        ForEach(setupKinds(for: side), id: \.0) { item in
                            setupToolButton(item.1, tool: .piece(side, item.0))
                        }
                    }
                }
            }
            if let message = viewModel.setupMessage { Text(message).font(.caption).foregroundStyle(.red) }
        }
        .padding(10)
        .background(.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.black.opacity(0.10)))
    }

    private func setupToolButton(_ title: String, tool: SetupTool) -> some View {
        Button(title) { viewModel.setSetupTool(tool) }
            .buttonStyle(.bordered)
            .tint(viewModel.setupTool == tool ? green : .gray)
    }

    private func setupKinds(for side: XiangqiSide) -> [(PieceKind, String)] {
        [(.rook, "车"), (.horse, "马"), (.elephant, side == .red ? "相" : "象"), (.advisor, side == .red ? "仕" : "士"), (.king, side == .red ? "帅" : "将"), (.cannon, "炮"), (.pawn, side == .red ? "兵" : "卒")]
    }

    private var candidateArrowToggle: some View {
        Button { viewModel.toggleCandidateArrows() } label: {
            Text("优")
                .font(.system(size: 17, weight: .bold, design: .serif))
                .foregroundStyle(viewModel.showsCandidateArrows ? .white : green)
                .frame(width: 38, height: 38)
                .background(
                    viewModel.showsCandidateArrows ? green : green.opacity(0.09),
                    in: Circle()
                )
                .overlay(Circle().stroke(green.opacity(viewModel.showsCandidateArrows ? 1 : 0.45), lineWidth: 2))
                .shadow(color: viewModel.showsCandidateArrows ? green.opacity(0.28) : .clear, radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .disabled(viewModel.globalLines.isEmpty || viewModel.isAnalyzing)
        .opacity((viewModel.globalLines.isEmpty || viewModel.isAnalyzing) ? 0.42 : 1)
        .accessibilityLabel(viewModel.showsCandidateArrows ? "隐藏全局候选箭头" : "显示全局候选箭头")
        .accessibilityValue(viewModel.showsCandidateArrows ? "已显示" : "已隐藏")
    }

    private var boardHint: String {
        if viewModel.gameMode == .setup {
            switch viewModel.setupTool {
            case .move: return "摆盘：点击棋子后，再点击目标位置"
            case .erase: return "摆盘：点击棋子即可删除"
            case let .piece(side, kind): return "摆盘：点击棋盘放置\(BoardPiece(side: side, kind: kind, file: 0, rank: 0).name)"
            }
        }
        if viewModel.gameMode == .computer && !viewModel.canHumanMove { return "电脑正在计算并将自动走出首选着法" }
        if let frame = viewModel.variationPreviewFrame {
            return "正在动画演示 \(frame.step)：\(frame.notation)；双击候选仍可直接落子"
        }
        if let previewPly = viewModel.timelinePreviewPly {
            return "正在滑移预览\(previewPly == 0 ? "开局" : "第 \(previewPly) 步后")，松手即可到达"
        }
        if let piece = viewModel.selectedPiece {
            if viewModel.isAnalyzingSelection { return "已选中\(piece.name)：蓝色为合法落点，正在计算绿色首选" }
            return "已选中\(piece.name)：绿色为本子首选，蓝色为其他合法落点"
        }
        if viewModel.activePly < viewModel.history.count {
            return "正在查看第 \(viewModel.activePly) 步后的历史局面；现在落子会替换后续 \(viewModel.history.count - viewModel.activePly) 步"
        }
        return "点击本方棋子开始；候选着法可双击直接落子"
    }

    private var analysisPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            panelTitle(number: "01", chinese: "教练分析", english: "COACH REVIEW")

            if let error = viewModel.errorMessage {
                VStack(alignment: .leading, spacing: 6) {
                    Label("皮卡鱼计算失败", systemImage: "exclamationmark.triangle.fill").font(.headline)
                    Text(error).font(.caption)
                    Text("本次不显示候选或推测性评分。").font(.caption.weight(.semibold))
                }
                .foregroundStyle(.red)
                .padding(12)
                .background(.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            } else if let piece = viewModel.selectedPiece {
                selectedPieceSummary(piece)
            } else {
                reviewSummary
            }

            globalBestSummary
            Divider()
            Text(viewModel.selectedPiece == nil ? "全局候选着法 · 单击动画演示 · 双击落子" : "这枚棋子的候选 · 单击动画演示 · 双击落子")
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)

            let lines = viewModel.selectedPiece == nil ? viewModel.globalLines : viewModel.selectedLines
            if (viewModel.selectedPiece == nil && viewModel.isAnalyzing) || viewModel.isAnalyzingSelection {
                ProgressView("深度 \(viewModel.analysisDepth) 计算中…")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 10)
            }
            ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                candidateRow(line, index: index, selectedScope: viewModel.selectedPiece != nil)
            }
        }
        .panelStyle()
    }

    private func selectedPieceSummary(_ piece: BoardPiece) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("\(piece.name)怎么走").font(.headline)
                Spacer()
                Text(viewModel.isAnalyzingSelection ? "分析中" : viewModel.selectedIsGlobalBest ? "全局最优" : "本子首选")
                    .font(.caption.bold()).foregroundStyle(green)
            }
            if let line = viewModel.selectedLines.first {
                Text("\(viewModel.notation(for: line)) · 走后评分 \(viewModel.scoreText(for: line))")
                    .font(.title3.bold()).foregroundStyle(moveColor(for: viewModel.sideToMove))
            }
            Text(viewModel.selectedIsGlobalBest
                 ? "这枚棋子的首选与全局第一候选评分相同，属于全局最优着法。"
                 : "共 \(viewModel.selectedLegalMoves.count) 个合法落点。绿色表示本子首选；当前评分低于全局首选。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
        .background(green.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    private var reviewSummary: some View {
        let review = viewModel.review
        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(review.grade).font(.caption.bold()).foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 4).background(green)
                Text(viewModel.activeMove?.notation ?? "等待落子").font(.headline)
                    .foregroundStyle(viewModel.activeMove.map { moveColor(for: $0.mover) } ?? ink)
                Spacer()
            }
            Text(review.summary).font(.subheadline.bold())
            Text(review.detail).font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
        .background(green.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    private var globalBestSummary: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("全局最优着法").font(.caption.weight(.semibold)).foregroundStyle(red)
            if let best = viewModel.globalLines.first {
                HStack {
                    VStack(alignment: .leading) {
                        Text(viewModel.notation(for: best)).font(.headline)
                            .foregroundStyle(moveColor(for: viewModel.sideToMove))
                        Text("走后评分 \(viewModel.scoreText(for: best)) · 深度 \(best.depth)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(viewModel.selectedPiece == nil || viewModel.selectedIsGlobalBest ? "最佳" : "优先考虑")
                        .font(.caption.bold()).foregroundStyle(green)
                }
                .contentShape(Rectangle())
                .gesture(candidateTapGesture(for: best))
            } else {
                Text(viewModel.isAnalyzing ? "正在计算…" : "暂无可靠结果").font(.caption)
            }
        }
        .padding(10)
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(red.opacity(0.25)))
    }

    private func candidateRow(_ line: EngineLine, index: Int, selectedScope: Bool) -> some View {
        let isHighlighted = viewModel.previewedCandidateMove == nil
            ? index == 0
            : viewModel.previewedCandidateMove == line.firstMove
        return HStack(spacing: 10) {
            Text("\(index + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(viewModel.notation(for: line)).font(.subheadline.bold())
                    .foregroundStyle(moveColor(for: viewModel.sideToMove))
                Text(index == 0 ? "皮卡鱼首选" : "深度 \(line.depth) · \(formattedNodes(line.nodes)) 节点")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Text(selectedScope ? (index == 0 ? "本子最佳" : "可行") : viewModel.quality(for: line, index: index))
                .font(.caption2.bold())
                .foregroundStyle(index == 0 ? green : .secondary)
            Text("走后 \(viewModel.scoreText(for: line))").font(.caption.bold()).monospacedDigit()
        }
        .padding(10)
        .background(isHighlighted ? green.opacity(0.10) : Color.white.opacity(0.45), in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(isHighlighted ? green.opacity(0.72) : .gray.opacity(0.18), lineWidth: isHighlighted ? 1.5 : 1))
        .contentShape(Rectangle())
        .gesture(candidateTapGesture(for: line))
    }

    private func candidateTapGesture(for line: EngineLine) -> some Gesture {
        TapGesture(count: 2)
            .exclusively(before: TapGesture(count: 1))
            .onEnded { result in
                switch result {
                case .first:
                    if viewModel.canHumanMove, let move = line.firstMove { viewModel.play(move) }
                case .second:
                    viewModel.previewVariation(line)
                    boardFocusRequest += 1
                }
            }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 24) {
                VStack(alignment: .leading) {
                    Text("\(viewModel.completedRounds)").font(.title.bold()).monospacedDigit()
                    Text("已走回合").font(.caption).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading) {
                    Text(viewModel.activePly == 0 ? "—" : viewModel.review.grade).font(.title3.bold())
                    Text("本步质量").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("双方各走一步计 1 回合").font(.caption).foregroundStyle(.secondary)
            }
            if !viewModel.history.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        historyButton(title: "开局", ply: 0)
                        ForEach(Array(viewModel.history.enumerated()), id: \.element.id) { index, record in
                            historyButton(title: "\(index / 2 + 1)\(record.mover == .red ? "." : "…") \(record.notation)", ply: index + 1, side: record.mover)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
    }

    private var situationPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                panelTitle(number: "02", chinese: "局势图", english: "POSITION TREND")
                Spacer()
                let displayedPly = viewModel.timelinePreviewPly ?? viewModel.activePly
                Text("正在查看：\(displayedPly == 0 ? "开局" : "第 \(displayedPly) 步后") · 红方视角")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("在曲线上按住滑移可快速预览棋盘，松手到达该步；在历史局面落子会创建新分支。")
                .font(.caption).foregroundStyle(.secondary)
            SituationChartView(
                points: viewModel.evaluationPoints,
                isAnalyzing: viewModel.isAnalyzing,
                activePly: viewModel.activePly,
                boardFlipped: viewModel.boardFlipped,
                piecesAtPly: { viewModel.pieces(atPly: $0) },
                onPreviewPly: { viewModel.previewTimeline($0) },
                onSelectPly: { viewModel.commitTimeline($0) }
            )
                .frame(height: 230)
        }
        .panelStyle()
    }

    private func historyButton(title: String, ply: Int, side: XiangqiSide? = nil) -> some View {
        let isCurrent = viewModel.activePly == ply
        let isFuture = ply > viewModel.activePly
        return Button(title) { viewModel.goToPly(ply) }
            .font(.caption.weight(isCurrent ? .bold : .medium))
            .foregroundStyle(side.map { moveColor(for: $0).opacity(isFuture ? 0.46 : 1) }
                ?? (isCurrent ? green : ink.opacity(isFuture ? 0.46 : 0.82)))
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(isCurrent ? green.opacity(0.12) : .white.opacity(0.6), in: Capsule())
            .overlay(Capsule().stroke(isCurrent ? green.opacity(0.7) : .gray.opacity(isFuture ? 0.18 : 0.28)))
            .buttonStyle(.plain)
    }

    private func moveColor(for side: XiangqiSide) -> Color {
        side == .red ? red : ink
    }

    private func panelTitle(number: String, chinese: String, english: String) -> some View {
        HStack(spacing: 10) {
            Text(number).font(.title2.bold()).foregroundStyle(Color(red: 0.66, green: 0.58, blue: 0.44))
            VStack(alignment: .leading, spacing: 1) {
                Text(chinese).font(.headline)
                Text(english).font(.caption2).tracking(1.2).foregroundStyle(.secondary)
            }
        }
    }

    private func formattedNodes(_ nodes: UInt64) -> String {
        if nodes >= 1_000_000 { return String(format: "%.1fM", Double(nodes) / 1_000_000) }
        if nodes >= 1_000 { return String(format: "%.0fK", Double(nodes) / 1_000) }
        return String(nodes)
    }
}

private extension View {
    func panelStyle() -> some View {
        padding(16)
            .background(Color.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.08)))
    }
}
