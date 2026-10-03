import Foundation
import Security

/// Uses the same API and account identity as web/local. Never stores passwords.
final class CloudAccountClient {
    struct Session: Codable {
        let token: String
        let name: String
        var id: String
        var nickname: String
        var presence: String
    }
    struct APIError: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { message }
    }
    private let endpoint = URL(string: "https://141.148.168.171")!
    private let transport: URLSession
    private let service = "com.yisi.xiangqicoach.cloud-session"
    private(set) var session: Session?

    init(transport: URLSession = .shared) {
        self.transport = transport
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "current",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data { session = try? JSONDecoder().decode(Session.self, from: data) }
    }

    func request(_ path: String, payload: [String: Any] = [:], authenticated: Bool = true) async throws -> [String: Any] {
        var request = URLRequest(url: endpoint.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authenticated {
            guard let session else { throw APIError(status: 401, message: "请登录") }
            request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError(status: 0, message: "服务器响应异常") }
        let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(response.statusCode) else {
            throw APIError(status: response.statusCode, message: value["error"] as? String ?? "网络请求失败")
        }
        return value
    }

    @discardableResult
    func signIn(name: String, password: String, registering: Bool = false) async throws -> Session {
        let value = try await request(registering ? "register" : "login", payload: ["name": name, "password": password], authenticated: false)
        guard let token = value["token"] as? String, let account = value["name"] as? String,
              let id = value["id"] as? String, let nickname = value["nickname"] as? String else {
            throw APIError(status: 0, message: "账号响应不完整")
        }
        let saved = Session(token: token, name: account, id: id, nickname: nickname, presence: value["presence"] as? String ?? "online")
        try persist(saved)
        session = saved
        return saved
    }

    /// A transport outage keeps the saved login; only an invalid credential clears it.
    func restore() async throws -> Session? {
        guard var saved = session else { return nil }
        do {
            let value = try await request("ice")
            saved.id = value["id"] as? String ?? saved.id
            saved.nickname = value["nickname"] as? String ?? saved.nickname
            saved.presence = value["presence"] as? String ?? saved.presence
            try persist(saved); session = saved
            return saved
        } catch let error as APIError where error.status == 401 {
            clear(); throw error
        }
    }

    func signOut() async throws {
        _ = try await request("logout")
        clear()
    }

    private func persist(_ saved: Session) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "current"]
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(saved),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw APIError(status: Int(status), message: "无法保存登录状态") }
    }

    private func clear() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "current"] as CFDictionary)
        session = nil
    }

    func forgetSession() { clear() }

    func eventsRequest() throws -> URLRequest {
        guard let session else { throw APIError(status: 401, message: "请登录") }
        var request = URLRequest(url: endpoint.appendingPathComponent("events"))
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 86400
        return request
    }
}
