import Foundation

enum XiangqiSide: String, Sendable {
    case red
    case black

    var opposite: XiangqiSide { self == .red ? .black : .red }
    var title: String { self == .red ? "红方" : "黑方" }
}

enum GameMode: String, CaseIterable, Identifiable, Sendable {
    case local, computer, setup
    var id: String { rawValue }
    var title: String {
        switch self { case .local: "双人对弈"; case .computer: "人机对战"; case .setup: "摆盘" }
    }
}

struct ComputerLevel: Identifiable, Hashable, Sendable {
    let name: String
    let elo: Int
    var id: Int { elo }

    static let all: [ComputerLevel] = [
        .init(name: "业余一级", elo: 1320), .init(name: "业余三级", elo: 1500),
        .init(name: "业余五级", elo: 1700), .init(name: "业余七级", elo: 1900),
        .init(name: "业余九级", elo: 2100), .init(name: "专业一级", elo: 2300),
        .init(name: "专业三级", elo: 2500), .init(name: "专业五级", elo: 2700),
        .init(name: "专业七级", elo: 2900), .init(name: "专业九级", elo: 3100)
    ]
}

enum SearchElo {
    static let minimum = 1320
    static let maximum = 3190
}

enum SetupTool: Hashable, Sendable {
    case move, erase, piece(XiangqiSide, PieceKind)
}

enum PieceKind: String, Hashable, Sendable {
    case rook, horse, elephant, advisor, king, cannon, pawn
}

struct BoardPiece: Identifiable, Hashable, Sendable {
    let side: XiangqiSide
    let kind: PieceKind
    let file: Int
    let rank: Int

    var id: String { "\(side.rawValue)-\(kind.rawValue)-\(file)-\(rank)" }

    var name: String {
        switch (side, kind) {
        case (_, .rook): "车"
        case (_, .horse): "马"
        case (.red, .elephant): "相"
        case (.black, .elephant): "象"
        case (.red, .advisor): "仕"
        case (.black, .advisor): "士"
        case (.red, .king): "帅"
        case (.black, .king): "将"
        case (_, .cannon): "炮"
        case (.red, .pawn): "兵"
        case (.black, .pawn): "卒"
        }
    }

    var uciSquare: String {
        "\(Character(UnicodeScalar(97 + file)!))\(9 - rank)"
    }
}

struct ParsedPosition: Sendable {
    let pieces: [BoardPiece]
    let sideToMove: XiangqiSide

    static func parse(fen: String) -> ParsedPosition {
        let fields = fen.split(separator: " ")
        let rows = fields.first?.split(separator: "/") ?? []
        var pieces: [BoardPiece] = []

        for (rank, row) in rows.prefix(10).enumerated() {
            var file = 0
            for character in row {
                if let emptyCount = character.wholeNumberValue {
                    file += emptyCount
                    continue
                }
                guard file < 9, let kind = pieceKind(for: character) else { continue }
                let side: XiangqiSide = character.isUppercase ? .red : .black
                pieces.append(BoardPiece(side: side, kind: kind, file: file, rank: rank))
                file += 1
            }
        }

        let side: XiangqiSide = fields.count > 1 && fields[1] == "b" ? .black : .red
        return ParsedPosition(pieces: pieces, sideToMove: side)
    }

    private static func pieceKind(for character: Character) -> PieceKind? {
        switch character.lowercased() {
        case "r": .rook
        case "n", "h": .horse
        case "b", "e": .elephant
        case "a": .advisor
        case "k": .king
        case "c": .cannon
        case "p": .pawn
        default: nil
        }
    }
}

/// Fast, deterministic Xiangqi rules used by the UI. Engine analysis is never
/// consulted to select a piece, show destinations, or apply a human move.
enum XiangqiRules {
    struct Outcome: Equatable {
        let title: String
        let detail: String
    }

    static func legalMoves(for side: XiangqiSide, pieces: [BoardPiece]) -> [String] {
        pieces.filter { $0.side == side }.flatMap { legalMoves(for: $0, pieces: pieces) }
    }

    static func legalMoves(for piece: BoardPiece, pieces: [BoardPiece]) -> [String] {
        var result: [String] = []
        for rank in 0..<10 {
            for file in 0..<9 where isLegal(piece, toFile: file, toRank: rank, pieces: pieces) {
                result.append(piece.uciSquare + square(file: file, rank: rank))
            }
        }
        return result
    }

    static func isLegal(_ piece: BoardPiece, toFile: Int, toRank: Int, pieces: [BoardPiece]) -> Bool {
        guard isPseudoLegal(piece, toFile: toFile, toRank: toRank, pieces: pieces) else { return false }
        var next = pieces.filter {
            !($0.file == toFile && $0.rank == toRank) && $0 != piece
        }
        next.append(BoardPiece(side: piece.side, kind: piece.kind, file: toFile, rank: toRank))
        return !isInCheck(piece.side, pieces: next)
    }

    static func outcome(for sideToMove: XiangqiSide, pieces: [BoardPiece]) -> Outcome? {
        let redHasKing = pieces.contains { $0.side == .red && $0.kind == .king }
        let blackHasKing = pieces.contains { $0.side == .black && $0.kind == .king }
        if !redHasKing { return Outcome(title: "黑方获胜", detail: "红方的帅已被吃掉。") }
        if !blackHasKing { return Outcome(title: "红方获胜", detail: "黑方的将已被吃掉。") }
        guard legalMoves(for: sideToMove, pieces: pieces).isEmpty else { return nil }
        let winner = sideToMove.opposite.title
        return Outcome(title: "\(winner)获胜", detail: "\(sideToMove.title)已无合法着法，\(winner)赢得本局。")
    }

    private static func isPseudoLegal(_ piece: BoardPiece, toFile file: Int, toRank rank: Int, pieces: [BoardPiece]) -> Bool {
        guard (0...8).contains(file), (0...9).contains(rank),
              file != piece.file || rank != piece.rank else { return false }
        let target = pieces.first { $0.file == file && $0.rank == rank }
        if target?.side == piece.side { return false }
        let dx = abs(file - piece.file), dy = abs(rank - piece.rank)
        let between = pieces.filter { candidate in
            candidate != piece &&
            ((candidate.file == piece.file && file == piece.file &&
              candidate.rank > min(rank, piece.rank) && candidate.rank < max(rank, piece.rank)) ||
             (candidate.rank == piece.rank && rank == piece.rank &&
              candidate.file > min(file, piece.file) && candidate.file < max(file, piece.file)))
        }
        switch piece.kind {
        case .rook:
            return (dx == 0 || dy == 0) && between.isEmpty
        case .cannon:
            return (dx == 0 || dy == 0) && between.count == (target == nil ? 0 : 1)
        case .horse:
            guard dx * dy == 2 else { return false }
            let legFile = dx == 2 ? piece.file + (file - piece.file) / 2 : piece.file
            let legRank = dy == 2 ? piece.rank + (rank - piece.rank) / 2 : piece.rank
            return !pieces.contains { $0.file == legFile && $0.rank == legRank }
        case .elephant:
            return dx == 2 && dy == 2 &&
                (piece.side == .red ? rank >= 5 : rank <= 4) &&
                !pieces.contains { $0.file == (file + piece.file) / 2 && $0.rank == (rank + piece.rank) / 2 }
        case .advisor:
            return dx == 1 && dy == 1 && (3...5).contains(file) &&
                (piece.side == .red ? rank >= 7 : rank <= 2)
        case .king:
            let flyingCapture = file == piece.file && target?.kind == .king && between.isEmpty
            return flyingCapture || (dx + dy == 1 && (3...5).contains(file) &&
                (piece.side == .red ? rank >= 7 : rank <= 2))
        case .pawn:
            let step = piece.side == .red ? -1 : 1
            let crossed = piece.side == .red ? piece.rank <= 4 : piece.rank >= 5
            return (file == piece.file && rank - piece.rank == step) ||
                (crossed && rank == piece.rank && dx == 1)
        }
    }

    private static func isInCheck(_ side: XiangqiSide, pieces: [BoardPiece]) -> Bool {
        guard let king = pieces.first(where: { $0.side == side && $0.kind == .king }) else { return true }
        return pieces.contains {
            $0.side != side && isPseudoLegal($0, toFile: king.file, toRank: king.rank, pieces: pieces)
        }
    }

    private static func square(file: Int, rank: Int) -> String {
        "\(Character(UnicodeScalar(97 + file)!))\(9 - rank)"
    }
}

struct EngineLine: Decodable, Identifiable, Sendable {
    let depth: Int
    let selDepth: Int
    let multipv: Int
    let score: String
    let pv: String
    let nodes: UInt64
    let nps: UInt64

    var id: Int { multipv }
    var moves: [String] { pv.split(separator: " ").map(String.init) }
    var firstMove: String? { moves.first }

    var centipawns: Int? {
        let fields = score.split(separator: " ")
        guard fields.count >= 2, fields[0] == "cp" else { return nil }
        return Int(fields[1])
    }

    func displayScore(redPerspectiveFor sideToMove: XiangqiSide) -> String {
        let fields = score.split(separator: " ")
        guard fields.count >= 2, let value = Int(fields[1]) else { return "—" }
        let redValue = sideToMove == .red ? value : -value
        if fields[0] == "mate" { return "\(redValue >= 0 ? "红方" : "黑方")杀\(abs(redValue))" }
        let pawns = Double(redValue) / 100
        return String(format: "%+.2f", pawns)
    }
}

struct EnginePayload: Decodable, Sendable {
    let lines: [EngineLine]
    let error: String?
}

struct MoveRecord: Identifiable, Sendable {
    let id = UUID()
    let beforeFEN: String
    let uci: String
    let notation: String
    let mover: XiangqiSide
    let beforeScore: Int?
    let wasEngineBest: Bool
    let bestBefore: String?
}

/// One engine evaluation at a board state. `ply` counts individual moves and
/// `score` is always normalized to red's point of view (positive means red is
/// better, negative means black is better).
struct EvaluationPoint: Identifiable, Sendable {
    let ply: Int
    let score: Int?

    var id: Int { ply }
}

struct VariationPreviewFrame: Sendable {
    let pieces: [BoardPiece]
    let movingPiece: BoardPiece?
    let capturedPiece: BoardPiece?
    let notation: String
    let step: String
    let fromFile: Int?
    let fromRank: Int?
    let toFile: Int?
    let toRank: Int?
}

enum ChineseNotation {
    private static let redFiles = ["九", "八", "七", "六", "五", "四", "三", "二", "一"]
    private static let numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]

    static func name(for uci: String, pieces: [BoardPiece]) -> String {
        guard let points = coordinates(uci),
              let piece = pieces.first(where: { $0.file == points.fromFile && $0.rank == points.fromRank })
        else { return uci }

        let forward = piece.side == .red ? points.toRank < points.fromRank : points.toRank > points.fromRank
        let diagonal = [.horse, .elephant, .advisor].contains(piece.kind)
        let startFile = fileName(points.fromFile, side: piece.side)
        let endFile = fileName(points.toFile, side: piece.side)

        let sameFile = pieces.filter {
            $0.side == piece.side && $0.kind == piece.kind && $0.file == piece.file
        }
        let prefix: String
        if sameFile.count == 2 {
            let frontRank = piece.side == .red ? sameFile.map(\.rank).min() : sameFile.map(\.rank).max()
            prefix = "\(piece.rank == frontRank ? "前" : "后")\(piece.name)"
        } else {
            prefix = "\(piece.name)\(startFile)"
        }

        if diagonal {
            return "\(prefix)\(forward ? "进" : "退")\(endFile)"
        }
        if points.fromFile != points.toFile {
            return "\(prefix)平\(endFile)"
        }

        let distance = abs(points.toRank - points.fromRank)
        let distanceText = piece.side == .red ? numerals[min(distance, 9)] : String(distance)
        return "\(prefix)\(forward ? "进" : "退")\(distanceText)"
    }

    static func coordinates(_ uci: String) -> (fromFile: Int, fromRank: Int, toFile: Int, toRank: Int)? {
        let characters = Array(uci)
        guard characters.count == 4,
              let fromScalar = characters[0].asciiValue,
              let fromUciRank = characters[1].wholeNumberValue,
              let toScalar = characters[2].asciiValue,
              let toUciRank = characters[3].wholeNumberValue
        else { return nil }
        let fromFile = Int(fromScalar) - 97
        let toFile = Int(toScalar) - 97
        guard (0...8).contains(fromFile), (0...8).contains(toFile) else { return nil }
        return (fromFile, 9 - fromUciRank, toFile, 9 - toUciRank)
    }

    private static func fileName(_ file: Int, side: XiangqiSide) -> String {
        side == .red ? redFiles[file] : String(file + 1)
    }
}

extension Character {
    fileprivate var asciiValue: UInt8? {
        unicodeScalars.count == 1 ? UInt8(exactly: unicodeScalars.first!.value) : nil
    }
}
