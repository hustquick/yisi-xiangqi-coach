import Foundation

final class MockCloudProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let rejected = request.url?.lastPathComponent == "login"
        let data = Data((rejected ? "{\"error\":\"账号或密码错误\"}" : "{\"ok\":true}").utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: rejected ? 401 : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct CloudAccountSmoke {
    static func main() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockCloudProtocol.self]
        let client = CloudAccountClient(transport: URLSession(configuration: configuration))
        let result = try await client.request("register", payload: ["name": "棋友甲", "password": "1"], authenticated: false)
        precondition(result["ok"] as? Bool == true)
        do {
            _ = try await client.request("login", authenticated: false)
            fatalError("Must reject invalid login")
        } catch let error as CloudAccountClient.APIError {
            precondition(error.status == 401 && error.message == "账号或密码错误")
        }
        print("PASS cloud JSON transport and server error propagation")
    }
}
