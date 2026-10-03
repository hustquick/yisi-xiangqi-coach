import Foundation
import SwiftUI

@MainActor
final class CloudLobbyModel: ObservableObject {
    struct Person: Identifiable {
        let name: String, id: String, nickname: String
        let online: Bool, busy: Bool, added: Bool
        let rating: Int, provisional: Bool
        init?(_ value: [String: Any]) {
            guard let name = value["name"] as? String, let id = value["id"] as? String else { return nil }
            self.name = name; self.id = id; nickname = value["nickname"] as? String ?? name
            online = value["online"] as? Bool ?? false; busy = value["busy"] as? Bool ?? false
            added = value["added"] as? Bool ?? false
            rating = value["rating"] as? Int ?? 1200; provisional = value["provisional"] as? Bool ?? true
        }
    }
    @Published var account: CloudAccountClient.Session?
    @Published var message = ""
    @Published var working = false
    @Published var friends: [Person] = []
    @Published var requests: [Person] = []
    @Published var results: [Person] = []
    @Published var history: [[String: Any]] = []
    @Published var records: [[String: Any]] = []
    @Published var invitation: [String: Any]?
    @Published var game: [String: Any]?
    @Published var watching: String?
    @Published var online = false
    @Published var matching = false
    var onEvent: (([String: Any]) -> Void)?
    let client: CloudAccountClient
    private var eventsTask: Task<Void, Never>?
    private var generation = 0

    init(client: CloudAccountClient = CloudAccountClient()) { self.client = client; account = client.session }
    var gameID: String? { game?["gameId"] as? String ?? game?["id"] as? String }
    var engaged: Bool { gameID != nil || watching != nil }
    func refreshRating() async {
        do { account = try await client.restore() } catch { handleError(error) }
    }

    func restore() async {
        guard account != nil else { return }
        do { account = try await client.restore(); subscribe() }
        catch { handleError(error) }
    }

    func authenticate(name: String, password: String, confirmation: String, registering: Bool) async {
        guard !working else { return }
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else { message = "请输入账号和密码"; return }
        guard !registering || password == confirmation else { message = "两次输入的密码不一致"; return }
        working = true; defer { working = false }
        // Retire the old event stream before replacing its credential. The
        // server signs the old session out when a new login succeeds.
        stop()
        do {
            account = try await client.signIn(name: name.trimmingCharacters(in: .whitespacesAndNewlines), password: password, registering: registering)
            message = ""; subscribe()
        } catch { handleError(error) }
    }

    @discardableResult
    func call(_ path: String, _ payload: [String: Any] = [:]) async throws -> [String: Any] {
        do { return try await client.request(path, payload: payload) }
        catch { handleError(error); throw error }
    }

    func action(_ path: String, _ payload: [String: Any] = [:], success: String = "") async {
        do { _ = try await call(path, payload); message = success }
        catch { /* call already publishes the error */ }
    }

    func refreshFriends() async {
        do { friends = people(try await call("friends")["friends"]) } catch {}
    }
    func search(_ query: String) async {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { results = []; return }
        do { results = people(try await call("search", ["name": query])["users"]); message = results.isEmpty ? "未找到用户" : "" } catch {}
    }
    func refreshHistory(opponentID: String? = nil) async {
        do { history = try await call("history", opponentID.map { ["opponentId": $0] } ?? [:])["games"] as? [[String: Any]] ?? [] } catch {}
    }
    func refreshRecords() async {
        do { records = try await call("records/list")["records"] as? [[String: Any]] ?? [] } catch {}
    }
    func saveRecord(_ content: [String: Any], title: String) async {
        let title = title.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !engaged, !working, !title.isEmpty else { message = "请输入棋谱名称，且先结束当前网络对局"; return }
        working = true; defer { working = false }
        do {
            _ = try CloudRecordCodec.decode(content)
            var saved = content
            var record = saved["record"] as? [String: Any] ?? [:]
            record["title"] = title; saved["record"] = record
            _ = try await call("records/save",["content":saved])
            await refreshRecords(); message = "棋谱已保存到云端"
        } catch { handleError(error) }
    }
    func rename(_ value: String) async {
        do { _ = try await call("profile", ["nickname": value]); account = try await client.restore(); message = "名称已更新" } catch { handleError(error) }
    }
    func changePresence(_ value: String) async {
        if value == "logout" { await logout(); return }
        do { _ = try await call("presence", ["mode": value]); account = try await client.restore(); message = "" } catch { handleError(error) }
    }
    func logout() async {
        do {
            try await client.signOut(); stop(); account = nil; game = nil; watching = nil
            friends = []; requests = []; results = []; history = []; records = []; invitation = nil
            message = "已退出登录"
        } catch { handleError(error) }
    }
    func stop() { generation += 1; eventsTask?.cancel(); eventsTask = nil; online = false; matching = false }
    func subscribe() {
        stop(); let revision = generation
        eventsTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled && generation == revision && account != nil {
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: client.eventsRequest())
                    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                        throw CloudAccountClient.APIError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: "登录已失效，请重新登录")
                    }
                    online = true
                    for try await line in bytes.lines {
                        if Task.isCancelled || generation != revision { return }
                        // The shared server emits one complete JSON value per
                        // data line. AsyncLineSequence can omit blank lines,
                        // so never wait for an empty event separator here.
                        if line.hasPrefix("data:"), let data = String(line.dropFirst(5)).trimmingCharacters(in:.whitespaces).data(using:.utf8),
                           let value = try JSONSerialization.jsonObject(with:data) as? [String: Any] { receive(value) }
                    }
                } catch { if Task.isCancelled || generation != revision { return }; handleError(error) }
                online = false
                if account != nil { message = "连接已中断，正在恢复；对局保留五分钟" }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }
    private func people(_ value: Any?) -> [Person] { (value as? [[String: Any]] ?? []).compactMap(Person.init) }
    private func receive(_ value: [String: Any]) {
        switch value["type"] as? String {
        case "match-state": matching = value["waiting"] as? Bool ?? false
        case "presence": friends = people(value["users"]); requests = people(value["requests"])
        case "invite": invitation = value
        case "invite-expired": invitation = nil; message = "邀请已失效"
        case "declined": message = "对方拒绝对战"
        case "game": game = value; invitation = nil; watching = nil; matching = false
        case "ready":
            let current = (value["games"] as? [[String: Any]])?.first
            game = current
        case "signed-out":
            client.forgetSession(); stop(); account = nil; game = nil; watching = nil
            friends = []; requests = []; results = []; invitation = nil; history = []; records = []
            message = "账号已在其他设备登录，本端已退出"
        case "peer-left", "expired": game = nil; message = "对局已结束"
        case "round-finished": Task { await refreshRating() }
        default: break
        }
        onEvent?(value)
    }
    private func handleError(_ error: Error) {
        if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
        message = error.localizedDescription
        if let error = error as? CloudAccountClient.APIError, error.status == 401 {
            client.forgetSession(); stop(); account = nil; game = nil; watching = nil
        }
    }
}
