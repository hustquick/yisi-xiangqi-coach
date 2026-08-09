import SwiftUI

struct SituationChartView: View {
    let points: [EvaluationPoint]
    let isAnalyzing: Bool
    let activePly: Int
    let boardFlipped: Bool
    let piecesAtPly: (Int) -> [BoardPiece]
    let onPreviewPly: (Int?) -> Void
    let onSelectPly: (Int) -> Void

    @State private var scrubPly: Int?

    private let red = Color(red: 0.73, green: 0.17, blue: 0.13)
    private let black = Color(red: 0.12, green: 0.14, blue: 0.12)
    private let green = Color(red: 0.09, green: 0.48, blue: 0.31)
    private let grid = Color.black.opacity(0.13)

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topTrailing) {
                Canvas { context, size in
                    drawChart(in: &context, size: size)
                }

                if let scrubPly {
                    VStack(alignment: .leading, spacing: 4) {
                        TimelineBoardPreview(pieces: piecesAtPly(scrubPly), flipped: boardFlipped)
                            .frame(width: 104, height: 122)
                        Text(scrubPly == 0 ? "开局" : "第 \(scrubPly) 步后")
                            .font(.caption2.bold()).foregroundStyle(green)
                        if let score = points.first(where: { $0.ply == scrubPly })?.score {
                            Text("红方视角 \(String(format: "%+.2f", Double(score) / 100))")
                                .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                        } else {
                            Text("暂无评分").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(7)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.black.opacity(0.16)))
                    .shadow(color: .black.opacity(0.16), radius: 7, y: 3)
                    .padding(.top, 5).padding(.trailing, 6)
                    .allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { drag in
                        let ply = selectedPly(at: drag.location, size: geometry.size)
                        if scrubPly != ply {
                            scrubPly = ply
                            onPreviewPly(ply)
                        }
                    }
                    .onEnded { drag in
                        let ply = selectedPly(at: drag.location, size: geometry.size)
                        scrubPly = nil
                        onPreviewPly(nil)
                        onSelectPly(ply)
                    }
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("局势评分曲线，当前查看第 \(activePly) 步，按住滑移可预览，松手到达该步")
    }

    private func drawChart(in context: inout GraphicsContext, size: CGSize) {
        let plot = CGRect(x: 48, y: 14, width: max(1, size.width - 62), height: max(1, size.height - 42))
        let available = points.compactMap(\.score)
        let largest = available.map { abs($0) }.max() ?? 0
        let range = max(300, Int(ceil(Double(largest) / 100.0)) * 100)
        let finalPly = points.last?.ply ?? 0
        let lastPly = max(finalPly, 1)
        let displayedPly = scrubPly ?? activePly

        func position(_ point: EvaluationPoint, score: Int) -> CGPoint {
            let clamped = max(-range, min(range, score))
            return CGPoint(
                x: plot.minX + CGFloat(point.ply) / CGFloat(lastPly) * plot.width,
                y: plot.midY - CGFloat(clamped) / CGFloat(range) * plot.height * 0.5
            )
        }

        for fraction in [-1.0, -0.5, 0.0, 0.5, 1.0] {
            let y = plot.midY - CGFloat(fraction) * plot.height * 0.5
            var path = Path()
            path.move(to: CGPoint(x: plot.minX, y: y))
            path.addLine(to: CGPoint(x: plot.maxX, y: y))
            context.stroke(path, with: .color(fraction == 0 ? .black.opacity(0.34) : grid), lineWidth: fraction == 0 ? 1.4 : 1)
            let value = Int(Double(range) * fraction)
            let label = value == 0 ? "0" : String(format: "%+.1f", Double(value) / 100)
            context.draw(Text(label).font(.caption2.monospacedDigit()).foregroundStyle(.secondary),
                         at: CGPoint(x: plot.minX - 7, y: y), anchor: .trailing)
        }

        context.draw(Text("红优").font(.caption2.bold()).foregroundStyle(red),
                     at: CGPoint(x: plot.minX, y: plot.minY), anchor: .bottomLeading)
        context.draw(Text("黑优").font(.caption2.bold()).foregroundStyle(black),
                     at: CGPoint(x: plot.minX, y: plot.maxY), anchor: .topLeading)
        context.draw(Text("0").font(.caption2).foregroundStyle(.secondary),
                     at: CGPoint(x: plot.minX, y: plot.maxY + 10), anchor: .top)
        context.draw(Text("\(finalPly) 步").font(.caption2).foregroundStyle(.secondary),
                     at: CGPoint(x: plot.maxX, y: plot.maxY + 10), anchor: .topTrailing)

        for index in 1..<points.count {
            let previous = points[index - 1]
            let current = points[index]
            guard current.ply == previous.ply + 1,
                  let previousScore = previous.score,
                  let currentScore = current.score else { continue }
            drawSegment(in: &context, from: position(previous, score: previousScore), startScore: previousScore,
                        to: position(current, score: currentScore), endScore: currentScore, lineWidth: 3)
        }

        if let active = points.first(where: { $0.ply == displayedPly }) {
            let center = position(active, score: active.score ?? 0)
            var marker = Path()
            marker.move(to: CGPoint(x: center.x, y: plot.minY))
            marker.addLine(to: CGPoint(x: center.x, y: plot.maxY))
            context.stroke(marker, with: .color(green.opacity(0.48)), style: StrokeStyle(lineWidth: 1.5, dash: [5, 5]))
        }

        for point in points {
            let center = position(point, score: point.score ?? 0)
            let isCurrent = point.ply == displayedPly
            let radius: CGFloat = isCurrent ? 5.5 : 3
            let circle = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius,
                                                width: radius * 2, height: radius * 2))
            if let score = point.score {
                context.fill(circle, with: .color(isCurrent ? green : (score >= 0 ? red : black)))
            } else {
                context.fill(circle, with: .color(.white.opacity(0.82)))
                context.stroke(circle, with: .color(Color.gray.opacity(0.72)), lineWidth: 1.5)
            }
            if isCurrent {
                context.stroke(Path(ellipseIn: CGRect(x: center.x - radius - 3, y: center.y - radius - 3,
                                                      width: (radius + 3) * 2, height: (radius + 3) * 2)),
                               with: .color(green.opacity(0.30)), lineWidth: 4)
            }
        }

        if available.isEmpty {
            context.draw(Text(isAnalyzing ? "正在计算首个局面评分…" : "落子后将在这里生成评分曲线")
                .font(.subheadline).foregroundStyle(.secondary), at: CGPoint(x: plot.midX, y: plot.midY))
        } else if isAnalyzing && points.first(where: { $0.ply == activePly })?.score == nil {
            context.draw(Text("当前点计算中…").font(.caption).foregroundStyle(.secondary),
                         at: CGPoint(x: plot.maxX, y: plot.minY), anchor: .topTrailing)
        }
    }

    private func selectedPly(at location: CGPoint, size: CGSize) -> Int {
        let finalPly = points.last?.ply ?? 0
        let plotWidth = max(1, size.width - 62)
        let ratio = min(1, max(0, (location.x - 48) / plotWidth))
        return Int((ratio * CGFloat(finalPly)).rounded())
    }

    private func drawSegment(in context: inout GraphicsContext, from start: CGPoint, startScore: Int,
                             to end: CGPoint, endScore: Int, lineWidth: CGFloat) {
        if (startScore >= 0) == (endScore >= 0) || startScore == endScore {
            stroke(in: &context, from: start, to: end,
                   color: (startScore + endScore) >= 0 ? red : black, lineWidth: lineWidth)
            return
        }
        let ratio = CGFloat(abs(startScore)) / CGFloat(abs(startScore) + abs(endScore))
        let crossing = CGPoint(x: start.x + (end.x - start.x) * ratio,
                               y: start.y + (end.y - start.y) * ratio)
        stroke(in: &context, from: start, to: crossing,
               color: startScore >= 0 ? red : black, lineWidth: lineWidth)
        stroke(in: &context, from: crossing, to: end,
               color: endScore >= 0 ? red : black, lineWidth: lineWidth)
    }

    private func stroke(in context: inout GraphicsContext, from start: CGPoint, to end: CGPoint,
                        color: Color, lineWidth: CGFloat) {
        var path = Path()
        path.move(to: start)
        path.addLine(to: end)
        context.stroke(path, with: .color(color),
                       style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
    }
}

private struct TimelineBoardPreview: View {
    let pieces: [BoardPiece]
    let flipped: Bool

    var body: some View {
        Canvas { context, size in
            let inset: CGFloat = 6
            let cell = min((size.width - inset * 2) / 8, (size.height - inset * 2) / 9)
            let origin = CGPoint(x: (size.width - cell * 8) / 2, y: (size.height - cell * 9) / 2)
            func point(file: Int, rank: Int) -> CGPoint {
                CGPoint(x: origin.x + CGFloat(file) * cell, y: origin.y + CGFloat(rank) * cell)
            }
            context.fill(Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 5),
                         with: .color(Color(red: 0.88, green: 0.72, blue: 0.47)))
            var grid = Path()
            for rank in 0...9 {
                grid.move(to: point(file: 0, rank: rank)); grid.addLine(to: point(file: 8, rank: rank))
            }
            for file in 0...8 {
                grid.move(to: point(file: file, rank: 0)); grid.addLine(to: point(file: file, rank: 9))
            }
            context.stroke(grid, with: .color(.black.opacity(0.42)), lineWidth: 0.7)
            let river = CGRect(x: origin.x, y: origin.y + cell * 4, width: cell * 8, height: cell)
            context.fill(Path(river), with: .color(Color(red: 0.88, green: 0.72, blue: 0.47)))
            context.stroke(Path(river), with: .color(.black.opacity(0.42)), lineWidth: 0.7)
            for piece in pieces {
                let file = flipped ? 8 - piece.file : piece.file
                let rank = flipped ? 9 - piece.rank : piece.rank
                let center = point(file: file, rank: rank)
                let radius = cell * 0.36
                let circle = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius,
                                                    width: radius * 2, height: radius * 2))
                context.fill(circle, with: .color(Color(red: 0.96, green: 0.86, blue: 0.67)))
                context.stroke(circle, with: .color(piece.side == .red ? .red.opacity(0.85) : .black.opacity(0.78)), lineWidth: 0.8)
                context.draw(Text(piece.name).font(.system(size: cell * 0.42, weight: .semibold, design: .serif))
                    .foregroundStyle(piece.side == .red ? .red : .black), at: center)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}
