import XCTest
import UIKit
@testable import YisiXiangqiCoach

@MainActor final class MobileIntegrationTests: XCTestCase {
    private func waitUntil(_ condition: @escaping () -> Bool, timeout: Double = 30) async throws {
        let end = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > end { XCTFail("Condition timed out"); throw NSError(domain:"test",code:1) }
            try await Task.sleep(for:.milliseconds(50))
        }
    }
    func testCloudNativeMatchAndResume() async throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let a = CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.a"))
        let b = CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.b"))
        let boardA = CoachViewModel(), boardB = CoachViewModel()
        let gameA = CloudGameModel(), gameB = CloudGameModel()
        let window = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows.first }.first)
        for (index, game) in [gameA,gameB].enumerated() {
            game.transport.webView.frame = CGRect(x:index*4,y:0,width:2,height:2)
            window.addSubview(game.transport.webView)
        }
        gameA.attach(board:boardA,lobby:a); gameB.attach(board:boardB,lobby:b)
        await a.authenticate(name:"iOSTest\(stamp)A",password:"1",confirmation:"1",registering:true)
        await b.authenticate(name:"iOSTest\(stamp)B",password:"1",confirmation:"1",registering:true)
        XCTAssertNotNil(a.account,a.message); XCTAssertNotNil(b.account,b.message)
        do {
            try await waitUntil({a.online && b.online})
            NSLog("MOBILE TEST: accounts online")
            let invite = try await a.call("invite",["to":b.account!.name,"side":"red","minutes":15,"swapSides":true])
            _ = try await b.call("respond",["id":invite["id"]!,"accept":true])
            do { try await waitUntil({gameA.connected && gameB.connected}) }
            catch { NSLog("MOBILE TEST: A=%@ B=%@ lobbyA=%@ lobbyB=%@",gameA.status,gameB.status,a.message,b.message); throw error }
            NSLog("MOBILE TEST: data channel connected")
            XCTAssertFalse(boardA.isAnalyzing); XCTAssertFalse(boardB.isAnalyzing)
            XCTAssertFalse(boardB.canHumanMove)
            boardA.tap(file:0,rank:6); gameA.publishSelection()
            try await waitUntil({boardB.peerSquare == "a3"})
            boardA.play("a3a4"); gameA.publishBoard()
            try await waitUntil({boardB.activePly == 1})
            XCTAssertEqual(boardA.cloudPosition,boardB.cloudPosition)
            NSLog("MOBILE TEST: red move synchronized")
            XCTAssertFalse(boardA.canHumanMove); XCTAssertTrue(boardB.canHumanMove)
            boardA.tap(file:0,rank:3)
            XCTAssertNil(boardA.selectedSquare,"Cannot touch opponent after moving")
            boardB.play("a6a5"); gameB.publishBoard()
            NSLog("MOBILE TEST: black local ply=%ld connected=%d",boardB.activePly,gameB.connected)
            do { try await waitUntil({boardA.activePly == 2}) }
            catch { NSLog("MOBILE TEST: black sync A=%@ B=%@",gameA.status,gameB.status); throw error }
            try await Task.sleep(for:.seconds(2))
            XCTAssertEqual(boardA.cloudPosition,boardB.cloudPosition)
            await b.authenticate(name:b.account!.name,password:"1",confirmation:"",registering:false)
            NSLog("MOBILE TEST: reauth account=%d message=%@",b.account != nil,b.message)
            do {
                try await waitUntil({b.online})
                try await waitUntil({gameA.connected && gameB.connected})
            } catch {
                NSLog("MOBILE TEST: resume online=%d A=%@ B=%@ lobby=%@",b.online,gameA.status,gameB.status,b.message)
                throw error
            }
            XCTAssertEqual(boardA.activePly,2); XCTAssertEqual(boardB.activePly,2)
            NSLog("MOBILE TEST: password login resumed")
            boardA.play("c3c4"); gameA.publishBoard()
            try await waitUntil({boardB.activePly == 3})
            XCTAssertEqual(boardA.cloudPosition,boardB.cloudPosition)
            await gameA.operation("leave")
            try await waitUntil({!boardB.networkActive})
            await a.refreshHistory(); XCTAssertFalse(a.history.isEmpty)
            await a.logout(); await b.logout()
        } catch {
            await gameA.operation("leave"); await a.logout(); await b.logout()
            throw error
        }
    }
}
