import Foundation
import SwiftUI

@MainActor
final class CoachViewModel: ObservableObject {
    static let initialFEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
    static let availableDepths = [8, 10, 12, 14, 16]

    @Published private(set) var fen = initialFEN
    @Published private(set) var legalMoves: [String] = []
    @Published private(set) var globalLines: [EngineLine] = []
    @Published private(set) var selectedLines: [EngineLine] = []
    @Published private(set) var history: [MoveRecord] = []
    @Published private(set) var positionScores: [Int: Int] = [:]
    @Published private(set) var isAnalyzing = false
    @Published private(set) var isAnalyzingSelection = false
    @Published private(set) var isApplyingMove = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var selectedSquare: String?
    @Published private(set) var analysisDepth = 12
    @Published private(set) var showsCandidateArrows = false
    @Published private(set) var boardFlipped = false
    @Published private(set) var activePly = 0
    @Published private(set) var variationPreviewFrames: [VariationPreviewFrame] = []
    @Published private(set) var variationPreviewIndex: Int?
    @Published private(set) var variationPreviewProgress = 0.0
    @Published private(set) var previewedCandidateMove: String?
    @Published private(set) var timelinePreviewPly: Int?
    @Published private(set) var gameMode: GameMode = .local
    @Published private(set) var humanSide: XiangqiSide = .red
    @Published private(set) var setupTool: SetupTool = .move
    @Published private(set) var setupMessage: String?

    private let engine = PikafishService.shared
    private var positionGeneration = UUID()
    private var selectionGeneration = UUID()
    private var moveGeneration = UUID()
    private var timelineEndFEN = initialFEN
    private var variationPreviewTask: Task<Void, Never>?
    private var computerMoveTask: Task<Void, Never>?
    private var scoreBackfillTask: Task<Void, Never>?
    private var positionAnalysisTask: Task<Void, Never>?
    private var selectionAnalysisTask: Task<Void, Never>?

    var position: ParsedPosition { ParsedPosition.parse(fen: fen) }
    var pieces: [BoardPiece] { position.pieces }
    var sideToMove: XiangqiSide { position.sideToMove }
    var selectedPiece: BoardPiece? { pieces.first { $0.uciSquare == selectedSquare } }
    var selectedLegalMoves: [String] {
        guard let selectedSquare else { return [] }
        return legalMoves.filter { $0.hasPrefix(selectedSquare) }
    }
    var completedRounds: Int { activePly / 2 }
    var currentScore: String { globalLines.first.map { scoreText(for: $0) } ?? "—" }
    var activeMove: MoveRecord? { activePly > 0 ? history[activePly - 1] : nil }
    var variationPreviewFrame: VariationPreviewFrame? {
        guard let variationPreviewIndex, variationPreviewFrames.indices.contains(variationPreviewIndex) else { return nil }
        return variationPreviewFrames[variationPreviewIndex]
    }
    var isPreviewingVariation: Bool { variationPreviewFrame != nil }
    var canHumanMove: Bool { gameMode != .setup && (gameMode != .computer || sideToMove == humanSide) }
    var displayedPieces: [BoardPiece] {
        if let frame = variationPreviewFrame {
            guard let moving = frame.movingPiece else { return frame.pieces }
            return frame.pieces.filter { piece in
                piece != moving && piece != frame.capturedPiece
            }
        }
        if let timelinePreviewPly { return pieces(atPly: timelinePreviewPly) }
        return pieces
    }

    var evaluationPoints: [EvaluationPoint] {
        var points = history.enumerated().map { index, record in
            EvaluationPoint(
                ply: index,
                score: positionScores[index] ?? record.beforeScore.map { record.mover == .red ? $0 : -$0 }
            )
        }
        points.append(EvaluationPoint(ply: history.count, score: positionScores[history.count]))
        if let current = globalLines.first?.centipawns.map({ sideToMove == .red ? $0 : -$0 }),
           points.indices.contains(activePly) {
            points[activePly] = EvaluationPoint(ply: activePly, score: current)
        }
        return points
    }

    var selectedBestMove: String? { selectedLines.first?.firstMove }
    var globalBestMove: String? { globalLines.first?.firstMove }
    var selectedIsGlobalBest: Bool {
        guard let selected = selectedLines.first, let global = globalLines.first,
              let selectedBestMove, let globalBestMove else { return false }
        if selectedBestMove == globalBestMove { return true }
        if let selectedScore = selected.centipawns, let globalScore = global.centipawns {
            return selectedScore == globalScore
        }
        return selected.score == global.score
    }

    var review: (grade: String, summary: String, detail: String) {
        guard activePly > 0 else {
            return ("待走", "先看全局候选，再选择着法。", "点击棋子可查看该棋子的合法落点和皮卡鱼首选。")
        }
        let last = history[activePly - 1]
        let recoveredBefore = positionScores[activePly - 1].map { last.mover == .red ? $0 : -$0 }
        guard !isAnalyzing, errorMessage == nil,
              let before = recoveredBefore ?? last.beforeScore,
              let after = globalLines.first?.centipawns
        else {
            return (errorMessage == nil ? "计算中" : "未评分",
                    errorMessage == nil ? "正在复盘刚才的着法。" : "本次计算失败，没有生成推测性评价。",
                    errorMessage ?? "皮卡鱼正在比较走前和走后的评分。")
        }
        let scoreForMover = -after
        let loss = before - scoreForMover
        let beforeForRed = last.mover == .red ? before : -before
        let afterForRed = last.mover == .red ? scoreForMover : -scoreForMover
        let beforeText = String(format: "%+.2f", Double(beforeForRed) / 100)
        let afterText = String(format: "%+.2f", Double(afterForRed) / 100)
        let theme = moveTheme(last)
        let variation = principalVariationText()
        let change = positionChange(before: before, after: scoreForMover, loss: loss)
        let alternative = !last.wasEngineBest && last.bestBefore != nil
            ? "落子前皮卡鱼首选是\(last.bestBefore!)。"
            : ""
        let outlook = variation.isEmpty
            ? "按双方最佳应对，落子后的红方视角评分为 \(afterText)。"
            : "接下来的一条主变化是：\(variation)。按双方最佳应对，落子后的红方视角评分为 \(afterText)。"
        if last.wasEngineBest {
            return ("最佳", "红方视角评分 \(beforeText) → \(afterText)", "\(theme)；皮卡鱼在落子前将它排在首位。\(outlook)")
        }
        switch loss {
        case ...8:
            return ("最佳", "红方视角评分 \(beforeText) → \(afterText)", "\(theme)；\(change)。\(alternative)\(outlook)")
        case ...30:
            return ("优秀", "红方视角评分 \(beforeText) → \(afterText)", "\(theme)；\(change)。\(alternative)\(outlook)")
        case ...80:
            return ("可行", "红方视角评分 \(beforeText) → \(afterText)", "\(theme)；\(change)。\(alternative)\(outlook)")
        case ...150:
            return ("不准确", "红方视角评分 \(beforeText) → \(afterText)", "\(theme)；\(change)。\(alternative)\(outlook)")
        default:
            return ("失误", "红方视角评分 \(beforeText) → \(afterText)", "\(theme)；\(change)。\(alternative)\(outlook)")
        }
    }

    private func positionChange(before: Int, after: Int, loss: Int) -> String {
        if before >= 30, after <= -30 { return "局面由你方占优转为对方占优" }
        if before >= 30, after < 30 { return "原有优势基本被抹平" }
        if before > -30, after <= -30 { return "均衡局面转为对方占优" }
        if before <= -30, after < before { return "原有劣势进一步扩大" }
        if loss > 8 { return String(format: "相对最佳结果，评价下滑了 %.2f", Double(loss) / 100) }
        return "局面评价基本保持稳定"
    }

    private func moveTheme(_ record: MoveRecord) -> String {
        let position = ParsedPosition.parse(fen: record.beforeFEN)
        guard let coordinates = ChineseNotation.coordinates(record.uci),
              let piece = position.pieces.first(where: { $0.file == coordinates.fromFile && $0.rank == coordinates.fromRank })
        else { return "\(record.notation)改变了棋子位置" }
        if let captured = position.pieces.first(where: { $0.file == coordinates.toFile && $0.rank == coordinates.toRank }) {
            return "\(record.notation)用\(piece.name)吃掉了对方\(captured.name)，直接改变了双方子力和战术关系"
        }
        switch piece.kind {
        case .cannon where coordinates.toFile == 4 && coordinates.fromFile != coordinates.toFile:
            return "\(record.notation)把炮转入中路，增强了对将门和中心线的压力"
        case .cannon:
            return "\(record.notation)调整了炮的作用线路，为隔子攻击和后续兑子寻找支点"
        case .horse:
            return "\(record.notation)重新安排了马的位置，既要看新控制点，也要确认马腿是否畅通"
        case .rook:
            return "\(record.notation)改变了车所控制的直线，重点在于开放线和侵入点"
        case .pawn:
            return "\(record.notation)推进了兵卒，获得空间的同时也永久改变了这一线的结构"
        case .elephant, .advisor:
            return "\(record.notation)调整了防守阵型，并改变了将帅周围的控制点"
        case .king:
            return "\(record.notation)移动了将帅，需要结合对方将军手段判断安全性"
        }
    }

    private func principalVariationText() -> String {
        guard let line = globalLines.first else { return "" }
        return variationText(for: line, skipping: 0)
    }

    func continuation(for line: EngineLine) -> String {
        variationText(for: line, skipping: 1)
    }

    private func variationText(for line: EngineLine, skipping skippedMoves: Int) -> String {
        var position = pieces
        var names: [String] = []
        for (index, move) in line.moves.prefix(skippedMoves + 4).enumerated() {
            guard let coordinates = ChineseNotation.coordinates(move) else { continue }
            let captured = position.first { $0.file == coordinates.toFile && $0.rank == coordinates.toRank }
            let captureText = captured.map { "（吃\($0.name)）" } ?? ""
            if index >= skippedMoves {
                names.append("\(names.count + 1).\(ChineseNotation.name(for: move, pieces: position))\(captureText)")
            }
            guard
                  let moving = position.first(where: { $0.file == coordinates.fromFile && $0.rank == coordinates.fromRank })
            else { continue }
            position.removeAll { $0.file == coordinates.toFile && $0.rank == coordinates.toRank }
            position.removeAll { $0.file == coordinates.fromFile && $0.rank == coordinates.fromRank }
            position.append(BoardPiece(side: moving.side, kind: moving.kind, file: coordinates.toFile, rank: coordinates.toRank))
        }
        return names.joined(separator: " → ")
    }

    func start() {
        refreshAnalysis()
    }

    func setAnalysisDepth(_ newDepth: Int) {
        guard Self.availableDepths.contains(newDepth), newDepth != analysisDepth else { return }
        engine.stop()
        scoreBackfillTask?.cancel()
        analysisDepth = newDepth
        previewedCandidateMove = nil
        selectionGeneration = UUID()
        selectedLines = []
        isAnalyzingSelection = false
        if gameMode != .setup { refreshAnalysis() }
    }

    func setGameMode(_ mode: GameMode) {
        guard mode != gameMode else { return }
        if gameMode == .setup, mode != .setup {
            let kings = pieces.filter { $0.kind == .king }
            guard kings.filter({ $0.side == .red }).count == 1,
                  kings.filter({ $0.side == .black }).count == 1 else {
                setupMessage = "红帅和黑将必须各保留一枚。"
                return
            }
        }
        cancelComputerMove()
        engine.stop()
        scoreBackfillTask?.cancel()
        stopAllPreviews()
        clearSelection()
        setupMessage = nil
        gameMode = mode
        if mode == .setup {
            history.removeAll()
            positionScores.removeAll()
            activePly = 0
            timelineEndFEN = fen
            legalMoves = []
            globalLines = []
            isAnalyzing = false
            setupTool = .move
        } else {
            refreshAnalysis()
        }
    }

    func setHumanSide(_ side: XiangqiSide) {
        humanSide = side
        cancelComputerMove()
        scheduleComputerMoveIfNeeded()
    }

    func setSetupTool(_ tool: SetupTool) {
        setupTool = tool
        setupMessage = nil
        clearSelection()
    }

    func finishSetup() { setGameMode(.local) }

    func toggleCandidateArrows() {
        showsCandidateArrows.toggle()
    }

    func toggleBoardPerspective() {
        boardFlipped.toggle()
    }

    func pieces(atPly ply: Int) -> [BoardPiece] {
        let target = min(max(ply, 0), history.count)
        let targetFEN = target < history.count ? history[target].beforeFEN : timelineEndFEN
        return ParsedPosition.parse(fen: targetFEN).pieces
    }

    func previewTimeline(_ ply: Int?) {
        if ply != nil { stopVariationPreview() }
        timelinePreviewPly = ply.map { min(max($0, 0), history.count) }
    }

    func commitTimeline(_ ply: Int) {
        timelinePreviewPly = nil
        goToPly(ply)
    }

    func previewVariation(_ line: EngineLine) {
        stopVariationPreview()
        timelinePreviewPly = nil
        var previewPieces = pieces
        var frames = [VariationPreviewFrame(
            pieces: previewPieces,
            movingPiece: nil,
            capturedPiece: nil,
            notation: "\(notation(for: line)) · 准备演示",
            step: "准备",
            fromFile: nil, fromRank: nil, toFile: nil, toRank: nil
        )]
        // Nine complete rounds are at most eighteen individual moves.
        for (index, move) in line.moves.prefix(18).enumerated() {
            guard let coordinates = ChineseNotation.coordinates(move),
                  let moving = previewPieces.first(where: {
                      $0.file == coordinates.fromFile && $0.rank == coordinates.fromRank
                  }) else { continue }
            let notation = ChineseNotation.name(for: move, pieces: previewPieces)
            let captured = previewPieces.first {
                $0.file == coordinates.toFile && $0.rank == coordinates.toRank
            }
            frames.append(VariationPreviewFrame(
                pieces: previewPieces,
                movingPiece: moving,
                capturedPiece: captured,
                notation: notation,
                step: "\(index / 2 + 1)\(index.isMultiple(of: 2) ? "a" : "b")",
                fromFile: coordinates.fromFile,
                fromRank: coordinates.fromRank,
                toFile: coordinates.toFile,
                toRank: coordinates.toRank
            ))
            previewPieces.removeAll {
                ($0.file == coordinates.toFile && $0.rank == coordinates.toRank) ||
                ($0.file == coordinates.fromFile && $0.rank == coordinates.fromRank)
            }
            previewPieces.append(BoardPiece(
                side: moving.side,
                kind: moving.kind,
                file: coordinates.toFile,
                rank: coordinates.toRank
            ))
            if captured?.kind == .king { break }
        }
        guard frames.count > 1 else { return }
        previewedCandidateMove = line.firstMove
        variationPreviewFrames = frames
        variationPreviewIndex = 0
        variationPreviewProgress = 0
        variationPreviewTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 420_000_000)
            guard let self, !Task.isCancelled else { return }
            for index in 1..<frames.count {
                guard !Task.isCancelled else { return }
                self.variationPreviewProgress = 0
                self.variationPreviewIndex = index
                // Give SwiftUI one render pass at the source square, then move
                // the real piece view instead of replacing two static snapshots.
                try? await Task.sleep(nanoseconds: 45_000_000)
                guard !Task.isCancelled else { return }
                withAnimation(.timingCurve(0.20, 0.78, 0.24, 1.0, duration: 0.62)) {
                    self.variationPreviewProgress = 1
                }
                try? await Task.sleep(nanoseconds: 880_000_000)
            }
            try? await Task.sleep(nanoseconds: 1_150_000_000)
            guard !Task.isCancelled else { return }
            self.stopVariationPreview()
        }
    }

    func stopVariationPreview() {
        variationPreviewTask?.cancel()
        variationPreviewTask = nil
        variationPreviewFrames = []
        variationPreviewIndex = nil
        variationPreviewProgress = 0
    }

    private func stopAllPreviews() {
        stopVariationPreview()
        timelinePreviewPly = nil
    }

    func tap(file: Int, rank: Int) {
        if gameMode == .setup { editSetup(file: file, rank: rank); return }
        guard canHumanMove else { return }
        guard let selectedPiece else {
            if let piece = pieces.first(where: { $0.file == file && $0.rank == rank }), piece.side == sideToMove {
                select(piece)
            }
            return
        }

        if let ownPiece = pieces.first(where: { $0.file == file && $0.rank == rank && $0.side == sideToMove }) {
            select(ownPiece)
            return
        }

        let destination = "\(Character(UnicodeScalar(97 + file)!))\(9 - rank)"
        let move = selectedPiece.uciSquare + destination
        if selectedLegalMoves.contains(move) { play(move) }
    }

    func play(_ move: String) {
        guard gameMode != .setup, !isApplyingMove, legalMoves.contains(move) else { return }
        guard let points = ChineseNotation.coordinates(move),
              let movingPiece = pieces.first(where: {
                  $0.file == points.fromFile && $0.rank == points.fromRank
              })
        else { return }
        cancelComputerMove()
        stopAllPreviews()
        previewedCandidateMove = nil
        let oldFEN = fen
        let oldPieces = pieces
        let basePly = activePly
        let record = MoveRecord(
            beforeFEN: oldFEN,
            uci: move,
            notation: ChineseNotation.name(for: move, pieces: oldPieces),
            mover: sideToMove,
            beforeScore: globalLines.first?.centipawns,
            wasEngineBest: globalBestMove == move,
            bestBefore: globalBestMove.map { ChineseNotation.name(for: $0, pieces: oldPieces) }
        )
        positionGeneration = UUID()
        selectionGeneration = UUID()
        positionAnalysisTask?.cancel()
        selectionAnalysisTask?.cancel()
        engine.stop()
        scoreBackfillTask?.cancel()
        isAnalyzing = false
        isAnalyzingSelection = false
        globalLines = []
        clearSelection()
        errorMessage = nil

        // The move is already known to be legal. Apply it to the lightweight UI
        // model immediately instead of waiting behind a cancelled engine search.
        // Pikafish is then restarted asynchronously for the new position.
        var updated = oldPieces.filter {
            !($0.file == points.fromFile && $0.rank == points.fromRank) &&
            !($0.file == points.toFile && $0.rank == points.toRank)
        }
        updated.append(BoardPiece(
            side: movingPiece.side,
            kind: movingPiece.kind,
            file: points.toFile,
            rank: points.toRank
        ))
        let newFEN = Self.makeFEN(pieces: updated, side: sideToMove.opposite)
        if basePly < history.count { history.removeSubrange(basePly...) }
        positionScores = positionScores.filter { $0.key <= basePly }
        history.append(record)
        fen = newFEN
        activePly = basePly + 1
        timelineEndFEN = newFEN
        isApplyingMove = false
        legalMoves = []
        refreshAnalysis()
    }

    func undo() {
        guard activePly > 0 else { return }
        goToPly(activePly - 1)
    }

    func goToPly(_ ply: Int) {
        cancelComputerMove()
        stopAllPreviews()
        previewedCandidateMove = nil
        let target = min(max(ply, 0), history.count)
        guard target != activePly else { return }
        moveGeneration = UUID()
        positionGeneration = UUID()
        selectionGeneration = UUID()
        engine.stop()
        scoreBackfillTask?.cancel()
        isApplyingMove = false
        isAnalyzing = false
        errorMessage = nil
        fen = target < history.count ? history[target].beforeFEN : timelineEndFEN
        activePly = target
        legalMoves = []
        globalLines = []
        clearSelection()
        refreshAnalysis()
    }

    func reset() {
        cancelComputerMove()
        stopAllPreviews()
        previewedCandidateMove = nil
        moveGeneration = UUID()
        engine.stop()
        scoreBackfillTask?.cancel()
        isApplyingMove = false
        history.removeAll()
        positionScores.removeAll()
        fen = Self.initialFEN
        activePly = 0
        timelineEndFEN = Self.initialFEN
        clearSelection()
        if gameMode == .setup {
            legalMoves = []
            globalLines = []
            isAnalyzing = false
        } else {
            refreshAnalysis()
        }
    }

    func notation(for line: EngineLine) -> String {
        line.firstMove.map { ChineseNotation.name(for: $0, pieces: pieces) } ?? "—"
    }

    func scoreText(for line: EngineLine) -> String {
        line.displayScore(redPerspectiveFor: sideToMove)
    }

    func quality(for line: EngineLine, index: Int) -> String {
        guard index > 0,
              let best = globalLines.first?.centipawns,
              let score = line.centipawns
        else { return "最佳" }
        switch best - score {
        case ...15: return "优秀"
        case ...50: return "良好"
        case ...120: return "可行"
        default: return "需谨慎"
        }
    }

    private func select(_ piece: BoardPiece) {
        previewedCandidateMove = nil
        selectedSquare = piece.uciSquare
        selectedLines = []
        isAnalyzingSelection = true
        let moves = legalMoves.filter { $0.hasPrefix(piece.uciSquare) }
        let fenAtStart = fen
        let depthAtStart = analysisDepth
        let generation = UUID()
        selectionGeneration = generation
        selectionAnalysisTask?.cancel()

        guard !moves.isEmpty else {
            isAnalyzingSelection = false
            return
        }
        engine.stop()
        scoreBackfillTask?.cancel()
        selectionAnalysisTask = Task {
            do {
                let lines = try await engine.analyze(
                    fen: fenAtStart,
                    depth: depthAtStart,
                    multiPV: min(12, moves.count),
                    searchMoves: moves
                )
                guard selectionGeneration == generation,
                      fen == fenAtStart,
                      analysisDepth == depthAtStart
                else { return }
                selectedLines = lines
                isAnalyzingSelection = false
            } catch {
                guard selectionGeneration == generation,
                      fen == fenAtStart,
                      analysisDepth == depthAtStart
                else { return }
                selectedLines = []
                isAnalyzingSelection = false
            }
        }
    }

    private func clearSelection() {
        selectionAnalysisTask?.cancel()
        selectionAnalysisTask = nil
        selectionGeneration = UUID()
        selectedSquare = nil
        selectedLines = []
        isAnalyzingSelection = false
    }

    private func refreshAnalysis() {
        guard gameMode != .setup else { return }
        positionAnalysisTask?.cancel()
        let fenAtStart = fen
        let depthAtStart = analysisDepth
        let generation = UUID()
        positionGeneration = generation
        scoreBackfillTask?.cancel()
        isAnalyzing = true
        errorMessage = nil
        globalLines = []
        legalMoves = []

        positionAnalysisTask = Task {
            do {
                let moves = try await engine.legalMoves(fen: fenAtStart)
                guard positionGeneration == generation,
                      fen == fenAtStart,
                      analysisDepth == depthAtStart
                else { return }
                legalMoves = moves

                let lines = try await engine.analyze(fen: fenAtStart, depth: depthAtStart, multiPV: 5)
                guard positionGeneration == generation,
                      fen == fenAtStart,
                      analysisDepth == depthAtStart
                else { return }
                globalLines = lines
                if let score = lines.first?.centipawns {
                    positionScores[activePly] = sideToMove == .red ? score : -score
                }
                isAnalyzing = false
                scheduleComputerMoveIfNeeded()
                if let selectedSquare,
                   !isAnalyzingSelection,
                   selectedLines.isEmpty,
                   let piece = pieces.first(where: { $0.uciSquare == selectedSquare }) {
                    select(piece)
                }
                scheduleScoreBackfill()
            } catch {
                guard positionGeneration == generation,
                      fen == fenAtStart,
                      analysisDepth == depthAtStart
                else { return }
                errorMessage = error.localizedDescription
                isAnalyzing = false
            }
        }
    }

    private func scheduleScoreBackfill() {
        scoreBackfillTask?.cancel()
        guard gameMode != .setup else { return }
        let missing = (0...history.count).filter { positionScores[$0] == nil && $0 != activePly }
        guard !missing.isEmpty else { return }
        let snapshots = missing.map { ply -> (Int, String, XiangqiSide) in
            let snapshotFEN = ply < history.count ? history[ply].beforeFEN : timelineEndFEN
            return (ply, snapshotFEN, ParsedPosition.parse(fen: snapshotFEN).sideToMove)
        }
        let depth = min(10, analysisDepth)
        let generation = positionGeneration
        scoreBackfillTask = Task {
            for (ply, snapshotFEN, side) in snapshots {
                guard !Task.isCancelled, positionGeneration == generation else { return }
                do {
                    let lines = try await engine.analyze(fen: snapshotFEN, depth: depth, multiPV: 1)
                    guard !Task.isCancelled, positionGeneration == generation else { return }
                    if let score = lines.first?.centipawns {
                        positionScores[ply] = side == .red ? score : -score
                    }
                } catch {
                    if Task.isCancelled { return }
                }
            }
        }
    }

    private func editSetup(file: Int, rank: Int) {
        var updated = pieces
        setupMessage = nil
        switch setupTool {
        case .erase:
            updated.removeAll { $0.file == file && $0.rank == rank }
            clearSelection()
        case .move:
            if let selectedPiece {
                if selectedPiece.file == file, selectedPiece.rank == rank { clearSelection(); return }
                updated.removeAll { ($0.file == file && $0.rank == rank) || $0.id == selectedPiece.id }
                updated.append(BoardPiece(side: selectedPiece.side, kind: selectedPiece.kind, file: file, rank: rank))
                clearSelection()
            } else if let piece = updated.first(where: { $0.file == file && $0.rank == rank }) {
                selectedSquare = piece.uciSquare
            }
        case let .piece(side, kind):
            updated.removeAll { $0.file == file && $0.rank == rank }
            updated.append(BoardPiece(side: side, kind: kind, file: file, rank: rank))
        }
        fen = Self.makeFEN(pieces: updated, side: sideToMove)
        timelineEndFEN = fen
    }

    func toggleSetupSideToMove() {
        fen = Self.makeFEN(pieces: pieces, side: sideToMove.opposite)
        timelineEndFEN = fen
    }

    private func scheduleComputerMoveIfNeeded() {
        guard gameMode == .computer, sideToMove != humanSide, !isAnalyzing,
              !isApplyingMove, let move = globalBestMove else { return }
        let expectedFEN = fen
        computerMoveTask?.cancel()
        computerMoveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 520_000_000)
            guard let self, !Task.isCancelled, self.gameMode == .computer,
                  self.fen == expectedFEN, self.sideToMove != self.humanSide else { return }
            self.play(move)
        }
    }

    private func cancelComputerMove() {
        computerMoveTask?.cancel()
        computerMoveTask = nil
    }

    private static func makeFEN(pieces: [BoardPiece], side: XiangqiSide) -> String {
        let letters: [PieceKind: Character] = [.rook: "r", .horse: "n", .elephant: "b", .advisor: "a", .king: "k", .cannon: "c", .pawn: "p"]
        let rows = (0..<10).map { rank -> String in
            var text = "", empty = 0
            for file in 0..<9 {
                guard let piece = pieces.first(where: { $0.file == file && $0.rank == rank }), let base = letters[piece.kind] else { empty += 1; continue }
                if empty > 0 { text += String(empty); empty = 0 }
                text.append(piece.side == .red ? Character(String(base).uppercased()) : base)
            }
            if empty > 0 { text += String(empty) }
            return text
        }
        return "\(rows.joined(separator: "/")) \(side == .red ? "w" : "b") - - 0 1"
    }
}
