import Foundation

enum PikafishError: LocalizedError {
    case missingNetwork
    case engine(String)
    case malformedResponse

    var errorDescription: String? {
        switch self {
        case .missingNetwork: "应用内缺少 pikafish.nnue 神经网络"
        case .engine(let message): "皮卡鱼：\(message)"
        case .malformedResponse: "皮卡鱼返回了无法解析的数据"
        }
    }
}

private final class EngineCancellationFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }

    func check() throws {
        lock.lock()
        let shouldCancel = cancelled
        lock.unlock()
        if shouldCancel { throw CancellationError() }
    }
}

final class PikafishService: @unchecked Sendable {
    static let shared = PikafishService()

    // Engine work must never compete with touch handling and SwiftUI rendering.
    // A utility queue plus a small search-thread pool is deliberately conservative:
    // analysis takes a little longer, but moving a piece remains the priority.
    private let queue = DispatchQueue(label: "com.yisi.pikafish", qos: .utility)
    private var initialized = false

    func stop() {
        pf_stop()
    }

    /// Fire-and-forget interruption for a touch-driven board action. The C++
    /// stop flag is thread-safe; dispatching it keeps native engine work out of
    /// the main actor's tap transaction.
    func interruptForBoardAction() {
        DispatchQueue.global(qos: .userInteractive).async {
            pf_stop()
        }
    }

    func analyze(fen: String, depth: Int, multiPV: Int, searchMoves: [String] = []) async throws -> [EngineLine] {
        try await onEngineQueue {
            try self.ensureInitialized()
            let moves = searchMoves.joined(separator: " ")
            let response: String = fen.withCString { fenPointer in
                moves.withCString { movesPointer in
                    guard let result = pf_analyze(fenPointer, Int32(depth), Int32(multiPV), movesPointer) else { return "" }
                    return String(cString: result)
                }
            }
            guard let data = response.data(using: .utf8),
                  let payload = try? JSONDecoder().decode(EnginePayload.self, from: data)
            else { throw PikafishError.malformedResponse }
            if let error = payload.error { throw PikafishError.engine(error) }
            return payload.lines.sorted { $0.multipv < $1.multipv }
        }
    }

    func bestMove(fen: String, depth: Int, elo: Int) async throws -> String {
        try await onEngineQueue {
            try self.ensureInitialized()
            let response: String = fen.withCString { pointer in
                guard let result = pf_best_move(pointer, Int32(depth), Int32(elo)) else { return "" }
                return String(cString: result)
            }
            if response.hasPrefix("error:") { throw PikafishError.engine(String(response.dropFirst(6))) }
            guard response.count >= 4 else { throw PikafishError.malformedResponse }
            return response
        }
    }

    func legalMoves(fen: String) async throws -> [String] {
        try await onEngineQueue {
            try self.ensureInitialized()
            let response: String = fen.withCString { pointer in
                guard let result = pf_legal_moves(pointer) else { return "" }
                return String(cString: result)
            }
            if response.hasPrefix("error:") { throw PikafishError.engine(String(response.dropFirst(6))) }
            return response.split(separator: " ").map(String.init)
        }
    }

    func apply(move: String, to fen: String) async throws -> String {
        try await onEngineQueue {
            try self.ensureInitialized()
            let response: String = fen.withCString { fenPointer in
                move.withCString { movePointer in
                    guard let result = pf_apply_move(fenPointer, movePointer) else { return "" }
                    return String(cString: result)
                }
            }
            if response.hasPrefix("error:") { throw PikafishError.engine(String(response.dropFirst(6))) }
            guard response.contains("/") else { throw PikafishError.malformedResponse }
            return response
        }
    }

    private func ensureInitialized() throws {
        guard !initialized else { return }
        guard let network = Bundle.main.path(forResource: "pikafish", ofType: "nnue") else {
            throw PikafishError.missingNetwork
        }
        let response: String = network.withCString { pointer in
            // Two search threads materially reduce MultiPV latency on modern
            // iPhones while still reserving CPU capacity for SwiftUI and touch.
            let threads = max(1, min(2, ProcessInfo.processInfo.activeProcessorCount - 1))
            guard let result = pf_initialize(pointer, Int32(threads), 64) else { return "" }
            return String(cString: result)
        }
        if response.hasPrefix("error:") { throw PikafishError.engine(String(response.dropFirst(6))) }
        guard response == "ready" else { throw PikafishError.malformedResponse }
        initialized = true
    }

    private func onEngineQueue<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        let flag = EngineCancellationFlag()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                queue.async {
                    do {
                        try flag.check()
                        continuation.resume(returning: try work())
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        } onCancel: {
            flag.cancel()
            // Release the serial native-engine queue immediately when a newer
            // position supersedes this task.
            DispatchQueue.global(qos: .userInteractive).async {
                pf_stop()
            }
        }
    }
}
