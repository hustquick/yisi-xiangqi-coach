import Foundation

enum CloudRecordCodec {
    static func fen(pieces: [BoardPiece], turn: XiangqiSide, ply: Int = 0) -> String {
        let letters: [PieceKind: String] = [.rook:"r",.horse:"n",.elephant:"b",.advisor:"a",.king:"k",.cannon:"c",.pawn:"p"]
        let rows = (0..<10).map { rank -> String in
            var text = "", empty = 0
            for file in 0..<9 {
                if let piece = pieces.first(where: { $0.file == file && $0.rank == rank }) {
                    if empty > 0 { text += String(empty); empty = 0 }
                    let letter = letters[piece.kind]!
                    text += piece.side == .red ? letter.uppercased() : letter
                } else { empty += 1 }
            }
            if empty > 0 { text += String(empty) }; return text
        }
        return "\(rows.joined(separator: "/")) \(turn == .red ? "w" : "b") - - 0 \(ply / 2 + 1)"
    }
    static func encode(startFEN: String, moves: [String], title: String) -> [String: Any] {
        let initial = ParsedPosition.parse(fen: startFEN)
        let pieces: [[String: Any]] = initial.pieces.map { ["id":$0.id,"name":$0.name,"side":$0.side.rawValue,"x":$0.file,"y":$0.rank] }
        let steps: [[String: Any]] = moves.compactMap {
            guard let p = ChineseNotation.coordinates($0) else { return nil }
            return ["from":[p.fromFile,p.fromRank],"to":[p.toFile,p.toRank]]
        }
        return ["version":1,"record":["title":title,"pieces":pieces,"turn":initial.sideToMove.rawValue,"moves":steps],"activePly":steps.count]
    }
    static func decode(_ saved: [String: Any]) throws -> (fen: String, moves: [String], title: String) {
        guard saved["version"] as? Int == 1, let record = saved["record"] as? [String: Any],
              let raw = record["pieces"] as? [[String: Any]], raw.count <= 32,
              let steps = record["moves"] as? [[String: Any]], steps.count <= 1000,
              let side = XiangqiSide(rawValue: record["turn"] as? String ?? "") else { throw GameRecordError.invalid("云端棋谱格式错误") }
        let names: [String: PieceKind] = ["车":.rook,"马":.horse,"相":.elephant,"象":.elephant,"仕":.advisor,"士":.advisor,"帅":.king,"将":.king,"炮":.cannon,"兵":.pawn,"卒":.pawn]
        var pieces: [BoardPiece] = []
        for item in raw {
            guard let x = item["x"] as? Int, let y = item["y"] as? Int, (0..<9).contains(x), (0..<10).contains(y),
                  let kind = names[item["name"] as? String ?? ""], let color = XiangqiSide(rawValue:item["side"] as? String ?? ""),
                  !pieces.contains(where: { $0.file == x && $0.rank == y }) else { throw GameRecordError.invalid("云端棋子坐标错误") }
            pieces.append(.init(side:color,kind:kind,file:x,rank:y))
        }
        let initial = fen(pieces:pieces,turn:side)
        _ = try GameRecordIO.parseFEN(initial)
        var moves: [String] = [], turn = side
        for step in steps {
            guard let from = step["from"] as? [Int], let to = step["to"] as? [Int], from.count == 2, to.count == 2,
                  (0..<9).contains(from[0]), (0..<10).contains(from[1]), (0..<9).contains(to[0]), (0..<10).contains(to[1]),
                  let piece = pieces.first(where: { $0.file == from[0] && $0.rank == from[1] && $0.side == turn }),
                  XiangqiRules.isLegal(piece,toFile:to[0],toRank:to[1],pieces:pieces) else { throw GameRecordError.invalid("云端棋谱包含非法着法") }
            moves.append("\(piece.uciSquare)\(Character(UnicodeScalar(97+to[0])!))\(9-to[1])")
            pieces.removeAll { ($0.file == from[0] && $0.rank == from[1]) || ($0.file == to[0] && $0.rank == to[1]) }
            pieces.append(.init(side:piece.side,kind:piece.kind,file:to[0],rank:to[1])); turn = turn.opposite
        }
        return (initial,moves,record["title"] as? String ?? "云端对局")
    }
}
