import Foundation

struct PortableGame: Codable, Identifiable {
    var id: String
    var title: String
    var savedAt: Date
    var startFEN: String
    var moves: [String]
    var activePly: Int
}

enum GameRecordError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let text) = self { return text }; return nil }
}

enum GameRecordIO {
    static func parseFEN(_ text: String) throws -> String {
        let fen = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "^fen\\s+", with: "", options: .regularExpression)
        let fields = fen.split(whereSeparator: \Character.isWhitespace)
        guard fields.first?.split(separator: "/").count == 10 else {
            throw GameRecordError.invalid("FEN 必须包含 10 行棋盘。")
        }
        let parsed = ParsedPosition.parse(fen: fen)
        guard parsed.pieces.contains(where: { $0.kind == .king && $0.side == .red }),
              parsed.pieces.contains(where: { $0.kind == .king && $0.side == .black }) else {
            throw GameRecordError.invalid("FEN 必须同时包含红帅和黑将。")
        }
        return fen
    }

    static func parseXQF(_ data: Data) throws -> (fen: String, moves: [String]) {
        let bytes = [UInt8](data)
        guard bytes.count >= 1028, bytes[0] == 0x58, bytes[1] == 0x51 else {
            throw GameRecordError.invalid("不是有效的 XQF 棋谱文件。")
        }
        guard bytes[2] <= 10 else {
            throw GameRecordError.invalid("当前离线版支持 XQF 1.0（v10 及以下）。")
        }
        let order = "RNBAKABNRCCPPPPP" + "rnbakabnrccppppp"
        var board = Array(repeating: Character("1"), count: 90)
        for index in 0..<32 {
            let square = Int(bytes[16 + index]); guard square < 90 else { continue }
            let file = square / 10, rank = 9 - square % 10
            board[rank * 9 + file] = Array(order)[index]
        }
        var rows: [String] = []
        for rank in 0..<10 {
            var row = "", empty = 0
            for file in 0..<9 {
                let value = board[rank * 9 + file]
                if value == "1" { empty += 1 }
                else { if empty > 0 { row += String(empty); empty = 0 }; row.append(value) }
            }
            if empty > 0 { row += String(empty) }; rows.append(row)
        }
        var moves: [String] = [], offset = 1024
        while offset + 3 < bytes.count {
            let from = Int(bytes[offset]) - 24, to = Int(bytes[offset + 1]) - 32
            let flags = bytes[offset + 2]; offset += 4
            if (0..<90).contains(from), (0..<90).contains(to) {
                let fromFile = from / 10, fromRank = from % 10
                let toFile = to / 10, toRank = to % 10
                moves.append("\(Character(UnicodeScalar(97 + fromFile)!))\(fromRank)\(Character(UnicodeScalar(97 + toFile)!))\(toRank)")
            }
            if flags & 0x10 == 0 { break }
        }
        return (rows.joined(separator: "/") + " w - - 0 1", moves)
    }

    static func savedGames() -> [PortableGame] {
        guard let data = UserDefaults.standard.data(forKey: "yisi.xiangqi.savedGames") else { return [] }
        return (try? JSONDecoder().decode([PortableGame].self, from: data)) ?? []
    }

    static func store(_ games: [PortableGame]) {
        if let data = try? JSONEncoder().encode(Array(games.prefix(20))) {
            UserDefaults.standard.set(data, forKey: "yisi.xiangqi.savedGames")
        }
    }
}
