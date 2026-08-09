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
