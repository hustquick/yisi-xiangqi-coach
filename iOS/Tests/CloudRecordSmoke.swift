import Foundation

@main struct CloudRecordSmoke {
    static func main() throws {
        let initial = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
        let saved = CloudRecordCodec.encode(startFEN:initial,moves:["a3a4","a6a5"],title:"互通测试")
        let decoded = try CloudRecordCodec.decode(saved)
        precondition(decoded.fen == initial && decoded.moves == ["a3a4","a6a5"] && decoded.title == "互通测试")
        let position = ParsedPosition.parse(fen:initial)
        precondition(CloudRecordCodec.fen(pieces:position.pieces,turn:.red,ply:4).hasSuffix("w - - 0 3"))
        var invalid = saved
        var record = saved["record"] as! [String: Any]
        record["moves"] = [["from":[0,6],"to":[0,5]],["from":[0,3],"to":[0,9]]]
        invalid["record"] = record
        do { _ = try CloudRecordCodec.decode(invalid); fatalError("illegal record accepted") }
        catch is GameRecordError {}
        print("PASS web/native record round trip, protocol FEN and illegal-move rejection")
    }
}
