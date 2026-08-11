import SwiftUI

struct XiangqiBoardView: View {
    @ObservedObject var viewModel: CoachViewModel

    private let lineColor = Color(red: 0.24, green: 0.20, blue: 0.13)
    private let boardColor = Color(red: 0.86, green: 0.69, blue: 0.43)
    private let redColor = Color(red: 0.72, green: 0.14, blue: 0.11)
    private let blueMove = Color(red: 0.22, green: 0.43, blue: 0.83)
    private let greenMove = Color(red: 0.10, green: 0.57, blue: 0.32)

    var body: some View {
        GeometryReader { geometry in
            let metrics = BoardMetrics(size: geometry.size)
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(boardColor)
                    .shadow(color: .black.opacity(0.14), radius: 10, y: 5)

                boardLines(metrics)
                riverLabels(metrics)
                coordinateLabels(metrics)
                candidateArrows(metrics)
                moveMarkers(metrics)
                pieceButtons(metrics)
                previewMoveMarkers(metrics)
                previewMovingPieces(metrics)
                playbackBanner
            }
            .contentShape(Rectangle())
            .highPriorityGesture(
                SpatialTapGesture().onEnded { event in
                    guard !viewModel.isPreviewingVariation,
                          viewModel.timelinePreviewPly == nil else { return }
                    let visualFile = Int(round((event.location.x - metrics.origin.x) / metrics.cell))
                    let visualRank = Int(round((event.location.y - metrics.origin.y) / metrics.cell))
                    guard (0...8).contains(visualFile), (0...9).contains(visualRank) else { return }
                    let file = viewModel.boardFlipped ? 8 - visualFile : visualFile
                    let rank = viewModel.boardFlipped ? 9 - visualRank : visualRank
                    viewModel.tap(file: file, rank: rank)
                },
                including: .all
            )
        }
        .aspectRatio(0.77, contentMode: .fit)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("中国象棋棋盘")
    }

    private func boardLines(_ metrics: BoardMetrics) -> some View {
        Canvas { context, _ in
            var path = Path()
            for rank in 0...9 {
                path.move(to: metrics.point(file: 0, rank: rank))
                path.addLine(to: metrics.point(file: 8, rank: rank))
            }
            for file in 0...8 {
                if file == 0 || file == 8 {
                    path.move(to: metrics.point(file: file, rank: 0))
                    path.addLine(to: metrics.point(file: file, rank: 9))
                } else {
                    path.move(to: metrics.point(file: file, rank: 0))
                    path.addLine(to: metrics.point(file: file, rank: 4))
                    path.move(to: metrics.point(file: file, rank: 5))
                    path.addLine(to: metrics.point(file: file, rank: 9))
                }
            }
            palacePath(&path, metrics: metrics, top: true)
            palacePath(&path, metrics: metrics, top: false)
            context.stroke(path, with: .color(lineColor.opacity(0.82)), lineWidth: max(1, metrics.cell * 0.018))
        }
    }

    private func palacePath(_ path: inout Path, metrics: BoardMetrics, top: Bool) {
        let startRank = top ? 0 : 7
        let endRank = top ? 2 : 9
        path.move(to: metrics.point(file: 3, rank: startRank))
        path.addLine(to: metrics.point(file: 5, rank: endRank))
        path.move(to: metrics.point(file: 5, rank: startRank))
        path.addLine(to: metrics.point(file: 3, rank: endRank))
    }

    private func riverLabels(_ metrics: BoardMetrics) -> some View {
        Group {
            Text(viewModel.boardFlipped ? "漢 界" : "楚 河")
                .position(x: metrics.point(file: 2, rank: 4).x, y: metrics.riverY)
            Text(viewModel.boardFlipped ? "楚 河" : "漢 界")
                .position(x: metrics.point(file: 6, rank: 4).x, y: metrics.riverY)
        }
        .font(.system(size: metrics.cell * 0.34, weight: .semibold, design: .serif))
        .foregroundStyle(lineColor.opacity(0.52))
    }

    private func coordinateLabels(_ metrics: BoardMetrics) -> some View {
        let topLabels = viewModel.boardFlipped
            ? ["一", "二", "三", "四", "五", "六", "七", "八", "九"]
            : ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
        let bottomLabels = viewModel.boardFlipped
            ? ["9", "8", "7", "6", "5", "4", "3", "2", "1"]
            : ["九", "八", "七", "六", "五", "四", "三", "二", "一"]
        return ZStack {
            ForEach(0..<9, id: \.self) { file in
                Text(topLabels[file])
                    .foregroundStyle(viewModel.boardFlipped ? redColor : lineColor.opacity(0.78))
                    .position(x: metrics.point(file: file, rank: 0).x, y: metrics.topCoordinateY)
                Text(bottomLabels[file])
                    .foregroundStyle(viewModel.boardFlipped ? lineColor.opacity(0.78) : redColor)
                    .position(x: metrics.point(file: file, rank: 9).x, y: metrics.bottomCoordinateY)
            }
        }
        .font(.system(size: max(17, metrics.cell * 0.30), weight: .bold, design: .rounded))
    }

    private func candidateArrows(_ metrics: BoardMetrics) -> some View {
        Canvas { context, _ in
            guard viewModel.showsCandidateArrows, !viewModel.isAnalyzing,
                  !viewModel.isPreviewingVariation, viewModel.timelinePreviewPly == nil else { return }

            for (index, line) in viewModel.globalLines.prefix(4).enumerated() {
                guard let move = line.firstMove else { continue }
                guard let coordinates = ChineseNotation.coordinates(move) else { continue }
                let from = boardPoint(metrics, file: coordinates.fromFile, rank: coordinates.fromRank)
                let to = boardPoint(metrics, file: coordinates.toFile, rank: coordinates.toRank)
                let targetIsOccupied = viewModel.pieces.contains {
                    $0.file == coordinates.toFile && $0.rank == coordinates.toRank
                }
                drawCandidateArrow(
                    in: &context,
                    from: from,
                    to: to,
                    number: index + 1,
                    color: candidateColor(index: index),
                    cell: metrics.cell,
                    emphasized: index == 0,
                    targetIsOccupied: targetIsOccupied
                )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func drawCandidateArrow(
        in context: inout GraphicsContext,
        from: CGPoint,
        to: CGPoint,
        number: Int,
        color: Color,
        cell: CGFloat,
        emphasized: Bool,
        targetIsOccupied: Bool
    ) {
        let dx = to.x - from.x
        let dy = to.y - from.y
        let length = hypot(dx, dy)
        guard length > 1 else { return }

        let ux = dx / length
        let uy = dy / length
        let startTrim = min(cell * 0.43, length * 0.30)
        let endTrim = targetIsOccupied ? min(cell * 0.43, length * 0.30) : 0
        let start = CGPoint(x: from.x + ux * startTrim, y: from.y + uy * startTrim)
        // Empty destinations end at the intersection. Captures stop at the
        // piece edge while the arrow axis continues to aim at its center.
        let end = CGPoint(x: to.x - ux * endTrim, y: to.y - uy * endTrim)
        let lineWidth = max(3, cell * (emphasized ? 0.085 : 0.060))
        let headLength = max(8, cell * (emphasized ? 0.22 : 0.18))
        let perpendicular = CGPoint(x: -uy, y: ux)
        let visibleLength = hypot(end.x - start.x, end.y - start.y)
        let preferredLabelRadius = max(9, cell * (emphasized ? 0.18 : 0.15))
        let labelFitsOnShaft = visibleLength > preferredLabelRadius * 2.8 + headLength
        let labelRadius = labelFitsOnShaft
            ? preferredLabelRadius
            : min(preferredLabelRadius, max(7, visibleLength * 0.24))
        let labelBase = CGPoint(
            x: start.x + (end.x - start.x) * 0.46,
            y: start.y + (end.y - start.y) * 0.46
        )
        let labelOffset = labelFitsOnShaft
            ? 0
            : cell * (number.isMultiple(of: 2) ? -0.22 : 0.22)
        let labelCenter = CGPoint(
            x: labelBase.x + perpendicular.x * labelOffset,
            y: labelBase.y + perpendicular.y * labelOffset
        )

        var shaft = Path()
        if labelFitsOnShaft {
            // Leave a real geometric gap at the opaque number badge instead
            // of drawing a line underneath it.
            let gap = labelRadius + lineWidth * 0.62
            let beforeLabel = CGPoint(x: labelCenter.x - ux * gap, y: labelCenter.y - uy * gap)
            let afterLabel = CGPoint(x: labelCenter.x + ux * gap, y: labelCenter.y + uy * gap)
            shaft.move(to: start)
            shaft.addLine(to: beforeLabel)
            shaft.move(to: afterLabel)
            shaft.addLine(to: end)
        } else {
            shaft.move(to: start)
            shaft.addLine(to: end)
        }
        context.stroke(
            shaft,
            with: .color(color),
            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
        )

        let headWidth = headLength * 0.62
        var head = Path()
        head.move(to: end)
        head.addLine(to: CGPoint(
            x: end.x - ux * headLength + perpendicular.x * headWidth,
            y: end.y - uy * headLength + perpendicular.y * headWidth
        ))
        head.addLine(to: CGPoint(
            x: end.x - ux * headLength - perpendicular.x * headWidth,
            y: end.y - uy * headLength - perpendicular.y * headWidth
        ))
        head.closeSubpath()
        context.fill(head, with: .color(color))

        let labelRect = CGRect(
            x: labelCenter.x - labelRadius,
            y: labelCenter.y - labelRadius,
            width: labelRadius * 2,
            height: labelRadius * 2
        )
        context.fill(Path(ellipseIn: labelRect), with: .color(color))
        context.stroke(Path(ellipseIn: labelRect), with: .color(.white.opacity(0.92)), lineWidth: 1.5)
        context.draw(
            Text("\(number)")
                .font(.system(size: labelRadius * 1.05, weight: .bold, design: .rounded))
                .foregroundStyle(.white),
            at: labelCenter
        )
    }

    private func candidateColor(index: Int) -> Color {
        switch index {
        case 0: greenMove.opacity(0.96)
        case 1: Color(red: 0.78, green: 0.31, blue: 0.20).opacity(0.82)
        case 2: Color(red: 0.18, green: 0.43, blue: 0.72).opacity(0.78)
        default: Color(red: 0.48, green: 0.35, blue: 0.66).opacity(0.72)
        }
    }

    private func moveMarkers(_ metrics: BoardMetrics) -> some View {
        Group {
            if !viewModel.isPreviewingVariation && viewModel.timelinePreviewPly == nil {
                ForEach(viewModel.selectedLegalMoves, id: \.self) { move in
                    if let coordinates = ChineseNotation.coordinates(move) {
                        let best = move == viewModel.selectedBestMove
                        Button {
                            viewModel.tap(file: coordinates.toFile, rank: coordinates.toRank)
                        } label: {
                            Circle()
                                .fill(best ? greenMove : blueMove)
                                .frame(width: best ? metrics.cell * 0.34 : metrics.cell * 0.22,
                                       height: best ? metrics.cell * 0.34 : metrics.cell * 0.22)
                                .overlay {
                                    if best {
                                        Circle().stroke(.white.opacity(0.9), lineWidth: 2)
                                    }
                                }
                                .frame(width: metrics.cell * 0.78, height: metrics.cell * 0.78)
                        }
                        .buttonStyle(.plain)
                        .position(boardPoint(metrics, file: coordinates.toFile, rank: coordinates.toRank))
                        .accessibilityLabel(best ? "最佳落点" : "合法落点")
                    }
                }
            }
        }
    }

    private func previewMoveMarkers(_ metrics: BoardMetrics) -> some View {
        Group {
            if let frame = viewModel.variationPreviewFrame,
               let fromFile = frame.fromFile, let fromRank = frame.fromRank,
               let toFile = frame.toFile, let toRank = frame.toRank {
                Path { path in
                    path.move(to: boardPoint(metrics, file: fromFile, rank: fromRank))
                    path.addLine(to: boardPoint(metrics, file: toFile, rank: toRank))
                }
                .trim(from: 0, to: viewModel.variationPreviewProgress)
                .stroke(
                    greenMove.opacity(0.32),
                    style: StrokeStyle(lineWidth: max(2, metrics.cell * 0.035), lineCap: .round, dash: [5, 6])
                )
                Circle()
                    .stroke(greenMove.opacity(0.35 + viewModel.variationPreviewProgress * 0.55),
                            lineWidth: max(2, metrics.cell * 0.045))
                    .frame(width: metrics.cell * (0.72 + viewModel.variationPreviewProgress * 0.14),
                           height: metrics.cell * (0.72 + viewModel.variationPreviewProgress * 0.14))
                    .shadow(color: greenMove.opacity(0.28), radius: 5)
                    .position(boardPoint(metrics, file: toFile, rank: toRank))
            }
        }
        .allowsHitTesting(false)
    }

    private func previewMovingPieces(_ metrics: BoardMetrics) -> some View {
        Group {
            if let frame = viewModel.variationPreviewFrame,
               let moving = frame.movingPiece,
               let fromFile = frame.fromFile, let fromRank = frame.fromRank,
               let toFile = frame.toFile, let toRank = frame.toRank {
                let progress = viewModel.variationPreviewProgress
                let from = boardPoint(metrics, file: fromFile, rank: fromRank)
                let to = boardPoint(metrics, file: toFile, rank: toRank)
                let point = CGPoint(
                    x: from.x + (to.x - from.x) * progress,
                    y: from.y + (to.y - from.y) * progress
                )

                if let captured = frame.capturedPiece {
                    pieceDisc(captured, metrics: metrics)
                        .scaleEffect(max(0.72, 1 - max(0, progress - 0.70) * 0.70))
                        .opacity(max(0, 1 - max(0, progress - 0.70) / 0.30))
                        .position(boardPoint(metrics, file: captured.file, rank: captured.rank))
                }

                pieceDisc(moving, metrics: metrics)
                    .scaleEffect(1 + sin(progress * .pi) * 0.075)
                    .shadow(color: .black.opacity(0.18 + sin(progress * .pi) * 0.18),
                            radius: 2 + sin(progress * .pi) * 6,
                            y: 2 + sin(progress * .pi) * 4)
                    .position(point)
                    .zIndex(20)
            }
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var playbackBanner: some View {
        if let frame = viewModel.variationPreviewFrame {
            HStack(spacing: 8) {
                Image(systemName: "play.fill")
                Text("变化演示")
                Text(frame.step)
                    .font(.caption2.bold().monospaced())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 4)
                    .background(greenMove, in: Capsule())
                Text(frame.notation).fontWeight(.bold).foregroundStyle(greenMove)
                Button("退出") { viewModel.stopVariationPreview() }
                    .font(.caption2)
            }
            .font(.caption)
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(greenMove.opacity(0.35)))
            .shadow(color: .black.opacity(0.12), radius: 7, y: 3)
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.top, 10)
        } else if let previewPly = viewModel.timelinePreviewPly {
            Label(previewPly == 0 ? "滑移预览 · 开局" : "滑移预览 · 第 \(previewPly) 步后", systemImage: "arrow.left.and.right")
                .font(.caption.bold())
                .padding(.horizontal, 11).padding(.vertical, 7)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(greenMove.opacity(0.35)))
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.top, 10)
        }
    }

    private func pieceButtons(_ metrics: BoardMetrics) -> some View {
        ForEach(viewModel.displayedPieces) { piece in
            let selected = !viewModel.isPreviewingVariation && viewModel.timelinePreviewPly == nil && piece.uciSquare == viewModel.selectedSquare
            let targetMove = viewModel.isPreviewingVariation || viewModel.timelinePreviewPly != nil ? nil : viewModel.selectedLegalMoves.first { move in
                guard let coordinates = ChineseNotation.coordinates(move) else { return false }
                return coordinates.toFile == piece.file && coordinates.toRank == piece.rank
            }
            let bestTarget = targetMove == viewModel.selectedBestMove

            Button {
                viewModel.tap(file: piece.file, rank: piece.rank)
            } label: {
                ZStack {
                    if targetMove != nil {
                        Circle()
                            .stroke(bestTarget ? greenMove : blueMove, lineWidth: bestTarget ? 5 : 3)
                            .frame(width: metrics.cell * 0.92, height: metrics.cell * 0.92)
                    }
                    pieceDisc(piece, metrics: metrics)
                    if selected {
                        Circle()
                            .stroke(Color.blue, lineWidth: max(3, metrics.cell * 0.055))
                            .frame(width: metrics.cell * 0.88, height: metrics.cell * 0.88)
                    }
                }
                .frame(width: metrics.cell, height: metrics.cell)
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isPreviewingVariation || viewModel.timelinePreviewPly != nil)
            .position(boardPoint(metrics, file: piece.file, rank: piece.rank))
            .accessibilityLabel("\(piece.side.title)\(piece.name)")
        }
        .animation(.easeInOut(duration: 0.42), value: viewModel.variationPreviewIndex)
        .animation(.easeOut(duration: 0.12), value: viewModel.timelinePreviewPly)
    }

    private func pieceDisc(_ piece: BoardPiece, metrics: BoardMetrics) -> some View {
        ZStack {
            Circle()
                .fill(Color(red: 0.95, green: 0.85, blue: 0.65))
                .overlay {
                    Circle().stroke(piece.side == .red ? redColor : lineColor,
                                    lineWidth: max(1.8, metrics.cell * 0.035))
                }
                .shadow(color: .black.opacity(0.20), radius: 2, y: 2)
                .frame(width: metrics.cell * 0.78, height: metrics.cell * 0.78)
            Text(piece.name)
                .font(.system(size: metrics.cell * 0.45, weight: .medium, design: .serif))
                .foregroundStyle(piece.side == .red ? redColor : lineColor)
        }
        .frame(width: metrics.cell, height: metrics.cell)
    }

    private func boardPoint(_ metrics: BoardMetrics, file: Int, rank: Int) -> CGPoint {
        metrics.point(
            file: viewModel.boardFlipped ? 8 - file : file,
            rank: viewModel.boardFlipped ? 9 - rank : rank
        )
    }
}

private struct BoardMetrics {
    let size: CGSize
    let cell: CGFloat
    let origin: CGPoint

    init(size: CGSize) {
        self.size = size
        let horizontalCell = (size.width - 46) / 8
        let verticalCell = (size.height - 88) / 9
        cell = max(1, min(horizontalCell, verticalCell))
        origin = CGPoint(x: (size.width - cell * 8) / 2, y: (size.height - cell * 9) / 2)
    }

    func point(file: Int, rank: Int) -> CGPoint {
        CGPoint(x: origin.x + CGFloat(file) * cell, y: origin.y + CGFloat(rank) * cell)
    }

    var riverY: CGFloat { origin.y + cell * 4.5 }
    var topCoordinateY: CGFloat { max(13, origin.y - 31) }
    var bottomCoordinateY: CGFloat { min(size.height - 13, origin.y + cell * 9 + 31) }
}
