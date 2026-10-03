import SwiftUI

@MainActor
final class CloudGameModel: ObservableObject {
    @Published var status = ""
    @Published var clock: [String: Any] = [:]
    @Published var request: String?
    @Published var roundResult: String?
    @Published var stats: [String: Any]?
    @Published var boardFocus = 0
    @Published var peerOffline = false
    @Published var connected = false
    let transport = RTCTransport()
    private weak var board: CoachViewModel?
    private weak var lobby: CloudLobbyModel?
    private var currentID: String?
    private var pendingPly: Int?
    private var ackTask: Task<Void, Never>?
    private var clockTask: Task<Void, Never>?
    private var watchTask: Task<Void, Never>?
    private var watchedContent = ""
    private var watchRevision = 0
    private var connectionPrepared = false
    private var connectionRevision = 0
    private var pendingSignals: [[String: Any]] = []

    func attach(board: CoachViewModel, lobby: CloudLobbyModel) {
        self.board = board; self.lobby = lobby
        lobby.onEvent = { [weak self] in self?.event($0) }
        board.networkMove = { [weak self] in self?.sendMove($0) ?? false }
        transport.receive = { [weak self] in self?.peerEvent($0) }
    }
    private func packet(_ value: [String: Any]) { transport.command(["type":"send","value":value.merging(["gameId":currentID ?? ""]) { _, new in new }]) }
    private func peerEvent(_ value: [String: Any]) {
        guard let lobby, let board else { return }
        switch value["type"] as? String {
        case "ready": if value["supported"] as? Bool != true { lock("设备不支持点对点连接") }
        case "signal":
            guard let currentID else { return }
            Task { await lobby.action("signal",["gameId":currentID,"kind":value["kind"] ?? "","payload":value["payload"] ?? [:]]) }
        case "open": packet(["type":"sync","ply":board.activePly,"position":board.cloudPosition])
        case "closed": connected = false; board.networkConnected = false; status = "对局连接已断开，可重连；棋局保留五分钟"
        case "error": connected = false; board.networkConnected = false; status = value["message"] as? String ?? "对局连接异常"
        case "data":
            guard let message = value["value"] as? [String: Any], message["gameId"] as? String == currentID else { lock("对局身份不匹配"); return }
            switch message["type"] as? String {
            case "sync":
                guard message["ply"] as? Int == board.activePly, message["position"] as? String == board.cloudPosition else { lock("双方局面不一致，请重连核对"); return }
                connected = true; board.networkConnected = roundResult == nil; status = "对战已连接"; peerOffline = false
            case "ack":
                guard message["ply"] as? Int == pendingPly else { lock("落子确认不一致"); return }
                pendingPly = nil; ackTask?.cancel()
            case "selection":
                if message["point"] is NSNull { board.peerSquare = nil }
                else if board.sideToMove != board.networkSide, message["before"] as? String == board.cloudPosition,
                        let p = point(message["point"]) { board.peerSquare = square(p) }
            case "move":
                guard roundResult == nil, pendingPly == nil, board.sideToMove != board.networkSide,
                      message["ply"] as? Int == board.activePly, message["before"] as? String == board.cloudPosition,
                      let from = point(message["from"]), let to = point(message["to"]) else { lock("回合或局面不一致"); return }
                let before = board.activePly
                board.play(square(from)+square(to), remote:true)
                guard board.activePly == before+1 else { lock("对方着法不合法"); return }
                board.peerSquare = nil; packet(["type":"ack","ply":board.activePly]); publishBoard()
            default: lock("未知对局消息")
            }
        default: break
        }
    }
    private func point(_ value: Any?) -> [Int]? {
        guard let p = value as? [Int], p.count == 2, (0..<9).contains(p[0]), (0..<10).contains(p[1]) else { return nil }; return p
    }
    private func square(_ p: [Int]) -> String { "\(Character(UnicodeScalar(97+p[0])!))\(9-p[1])" }
    private func lock(_ reason: String) { connected = false; board?.networkConnected = false; status = reason }
    private func sendMove(_ move: String) -> Bool {
        guard let board, let currentID, connected, pendingPly == nil, roundResult == nil,
              board.sideToMove == board.networkSide, !board.networkWatching,
              let p = ChineseNotation.coordinates(move) else { return false }
        pendingPly = board.activePly+1
        packet(["type":"move","gameId":currentID,"ply":board.activePly,"before":board.cloudPosition,"from":[p.fromFile,p.fromRank],"to":[p.toFile,p.toRank]])
        ackTask?.cancel(); ackTask = Task { [weak self] in
            try? await Task.sleep(for:.seconds(10))
            guard !Task.isCancelled, self?.pendingPly != nil else { return }
            self?.lock("对方未确认落子，请重连核对")
        }
        return true
    }
    func publishSelection() {
        guard let board, let lobby, let currentID, connected, !board.networkWatching, board.sideToMove == board.networkSide else { return }
        let selected = board.selectedPiece.map { [$0.file,$0.rank] }
        let point: Any = selected.map { $0 as Any } ?? NSNull()
        packet(["type":"selection","point":point,"before":board.cloudPosition])
        Task { _ = try? await lobby.call("watch/selection",["gameId":currentID,"ply":board.activePly,"point":point]) }
    }
    func publishBoard() {
        guard let board, let lobby, let currentID, !board.networkWatching else { return }
        let content = board.cloudRecord, ply = board.activePly
        let ownMove = board.sideToMove != board.networkSide
        let result = board.gameOutcome != nil ? board.sideToMove.opposite.rawValue : nil
        Task {
            // Capture the mover before yielding: a fast peer reply can change
            // sideToMove while this upload is waiting. HTTP arrival order can
            // differ from ordered WebRTC, so retry a preceding-ply conflict.
            if ownMove {
                for attempt in 0..<6 {
                    guard self.currentID == currentID else { return }
                    do {
                        _ = try await lobby.client.request("clock/move",payload:["gameId":currentID,"ply":ply,"content":content])
                        break
                    } catch let error as CloudAccountClient.APIError where error.status == 409 && attempt < 5 {
                        try? await Task.sleep(for:.milliseconds(200))
                    } catch { lock("云端落子登记失败，请重连核对：\(error.localizedDescription)"); return }
                }
            }
            guard self.currentID == currentID else { return }
            _ = try? await lobby.call("watch/update",["gameId":currentID,"content":content])
            if let result { await lobby.action("next-game",["gameId":currentID,"result":result,"content":content]) }
        }
    }
    private func event(_ value: [String: Any]) {
        guard let board, let lobby else { return }
        let type = value["type"] as? String ?? ""
        if type == "game" || type == "ready" {
            guard let game = lobby.game, let id = lobby.gameID else { if currentID != nil { leaveLocally() }; return }
            let newGame = id != currentID
            connected = false; connectionPrepared = false; pendingSignals = []
            currentID = id; pendingPly = nil; ackTask?.cancel(); request = nil; roundResult = nil; stats = nil
            board.configureNetwork(active:true,side:game["red"] as? String == lobby.account?.name ? .red : .black)
            if newGame { board.reset() }
            if let saved = game["content"] as? [String: Any] { do { try board.loadCloudRecord(saved) } catch { lock(error.localizedDescription); return } }
            boardFocus += 1; startClock()
            Task { if type == "ready" { await lobby.action("signal",["gameId":id,"kind":"restart"]) }; await connect() }
        } else if type == "signal", value["gameId"] as? String == currentID {
            if value["kind"] as? String == "restart" { connectionPrepared = false; Task { await connect() } }
            else {
                let signal: [String: Any] = ["type":"signal","kind":value["kind"] ?? "","payload":value["payload"] ?? [:]]
                if connectionPrepared { transport.command(signal) } else { pendingSignals.append(signal) }
            }
        } else if type == "watch-state", value["name"] as? String == lobby.watching { applyWatch(value) }
        else if ["peer-left","expired","signed-out"].contains(type) { leaveLocally(); status = lobby.message }
        else if value["gameId"] as? String == currentID {
            switch type {
            case "peer-offline": peerOffline = true; status = "对方已断线，五分钟未恢复将结束对局"
            case "peer-online": peerOffline = false; status = "对方已恢复连接"
            case "draw-offer": request = "draw"; status = "对方提和，请选择同意或拒绝"
            case "undo-offer": request = "undo"; status = "对方申请悔棋"
            case "time-offer": request = "time"; status = "对方申请双方各加时五分钟"
            case "time-result": request = nil; status = value["accepted"] as? Bool == true ? "双方各加时五分钟" : "对方拒绝加时"
            case "draw-declined": status = "对方拒绝提和"
            case "undo-declined": status = "对方拒绝悔棋"
            case "undo-applied":
                request = nil; pendingPly = nil; ackTask?.cancel()
                if let content = value["content"] as? [String: Any] { do { try board.loadCloudRecord(content) } catch { lock(error.localizedDescription) } }
                status = "已回退一步，用时不回退"
            case "round-finished":
                request = nil; pendingPly = nil; ackTask?.cancel(); roundResult = value["result"] as? String
                stats = value["stats"] as? [String: Any]; board.networkConnected = false
                status = "本局结束，五秒后按邀请设置开始下一局"
            default: break
            }
        }
    }
    func connect() async {
        guard let lobby, let board, let id = currentID else { return }
        connectionPrepared = false; connectionRevision += 1; let revision = connectionRevision
        lock("正在连接对手…")
        do {
            let response = try await lobby.call("ice")
            guard id == currentID, revision == connectionRevision else { return }
            transport.command(["type":"connect","iceServers":response["iceServers"] ?? [],"initiator":board.networkSide == .red])
            connectionPrepared = true; pendingSignals.forEach(transport.command); pendingSignals = []
        } catch { status = error.localizedDescription }
    }
    func reconnect() async {
        guard let lobby, let id = currentID else { return }
        await lobby.action("signal",["gameId":id,"kind":"restart"]); await connect()
    }
    private func startClock() {
        clockTask?.cancel(); clockTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let lobby, let id = currentID else { return }
                if let result = try? await lobby.call("clock",["gameId":id]), id == currentID { clock = result }
                try? await Task.sleep(for:.seconds(1))
            }
        }
    }
    func operation(_ path: String, accept: Bool? = nil) async {
        guard let lobby, let board, let currentID else { return }
        var payload: [String: Any] = ["gameId":currentID,"content":board.cloudRecord]
        if let accept { payload["accept"] = accept }
        do { _ = try await lobby.call(path,payload); if accept != nil { request = nil }; if path == "leave" { lobby.game = nil; leaveLocally(); status = "已退出对局" } }
        catch { status = error.localizedDescription }
    }
    func watch(_ name: String) async {
        guard let lobby, let board, !lobby.engaged else { return }
        do {
            let value = try await lobby.call("watch",["name":name])
            lobby.watching = name; currentID = nil; watchedContent = ""
            board.configureNetwork(active:true,watching:true); applyWatch(value); boardFocus += 1
            watchTask?.cancel(); watchTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for:.seconds(2))
                    guard !Task.isCancelled, let self, lobby.watching == name else { return }
                    let revision = watchRevision
                    do { let value = try await lobby.call("watch",["name":name]); if revision == watchRevision { applyWatch(value) } }
                    catch { leaveLocally(); status = "对局已结束观战"; return }
                }
            }
        } catch { status = error.localizedDescription }
    }
    private func applyWatch(_ value: [String: Any]) {
        watchRevision += 1
        if let saved = value["content"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject:saved,options:.sortedKeys) {
            let encoded = data.base64EncodedString()
            if encoded != watchedContent { do { try board?.loadCloudRecord(saved); watchedContent = encoded } catch { status = error.localizedDescription } }
        }
        board?.peerSquare = point(value["selected"]).map(square)
    }
    func leaveLocally() {
        transport.command(["type":"close"]); ackTask?.cancel(); clockTask?.cancel(); watchTask?.cancel()
        currentID = nil; pendingPly = nil; connected = false; request = nil; roundResult = nil; peerOffline = false; clock = [:]
        connectionPrepared = false; connectionRevision += 1; pendingSignals = []
        lobby?.watching = nil; board?.configureNetwork(active:false)
    }
    func timeText(side: XiangqiSide) -> String {
        "已用 \(usedTime(side:side)) · 剩余 \(remainingTime(side:side))"
    }
    func usedTime(side: XiangqiSide) -> String { formatTime((clock["used"] as? [String: Double])?[side.rawValue] ?? 0) }
    func remainingTime(side: XiangqiSide) -> String {
        let used = (clock["used"] as? [String: Double])?[side.rawValue] ?? 0
        let limit = clock["limit"] as? Double ?? 900000
        return formatTime(limit-used)
    }
    private func formatTime(_ value: Double) -> String { let seconds = Int(max(0,value)/1000); return String(format:"%02d:%02d",seconds/60,seconds%60) }
}
