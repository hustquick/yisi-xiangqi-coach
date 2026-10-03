import XCTest
import UIKit
import SwiftUI
import WebKit
@testable import YisiXiangqiCoach

@MainActor final class MobileIntegrationTests: XCTestCase {
    func testDisconnectedPeerExpiresAfterFiveMinutes() async throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let a = CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.timeout.a"))
        let b = CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.timeout.b"))
        let board = CoachViewModel(), game = CloudGameModel()
        game.attach(board:board,lobby:a)
        await a.authenticate(name:"Timeout\(stamp)A",password:"1",confirmation:"1",registering:true)
        await b.authenticate(name:"Timeout\(stamp)B",password:"1",confirmation:"1",registering:true)
        do {
            try await waitUntil({a.online && b.online})
            let invite = try await a.call("invite",["to":b.account!.name,"side":"red","minutes":45,"swapSides":true])
            _ = try await b.call("respond",["id":invite["id"]!,"accept":true])
            try await waitUntil({board.networkActive})
            b.stop()
            try await waitUntil({game.peerOffline})
            XCTAssertTrue(game.status.contains("五分钟"))
            let offlineAt = Date()
            NSLog("MOBILE TEST: real five-minute disconnect grace started")
            try await waitUntil({!board.networkActive && !a.engaged},timeout:330)
            XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(offlineAt),285)
            XCTAssertLessThan(Date().timeIntervalSince(offlineAt),320)
            await a.refreshHistory(); XCTAssertTrue(a.history.isEmpty,"Unplayed rounds must not enter history")
            await a.logout(); await b.logout()
            NSLog("MOBILE TEST: real five-minute disconnect expiry and no unplayed history verified")
        } catch {
            await game.operation("leave"); await a.logout(); await b.logout(); throw error
        }
    }
    func testCloudRecordReviewRunsNativeEngine() async throws {
        let board = CoachViewModel()
        let saved = CloudRecordCodec.encode(startFEN:board.fen,moves:["a3a4","a6a5"],title:"云端复盘验证")
        try board.loadCloudRecord(saved,review:true)
        XCTAssertEqual(board.activePly,0); XCTAssertEqual(board.history.count,2)
        XCTAssertFalse(board.networkActive)
        try await waitUntil({!board.globalLines.isEmpty},timeout:45)
        XCTAssertNotEqual(board.currentScore,"—")
        board.goToPly(2)
        XCTAssertEqual(board.activePly,2)
        try await waitUntil({!board.globalLines.isEmpty},timeout:45)
        XCTAssertTrue(board.globalLines.allSatisfy { !($0.pv.isEmpty) })
        board.configureNetwork(active:true,side:.red)
        XCTAssertTrue(board.globalLines.isEmpty); XCTAssertFalse(board.isAnalyzing)
        NSLog("MOBILE TEST: downloaded record replay and actual native engine analysis verified")
    }
    func testNativeAgainstPublishedWebClient() async throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let native = CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.interop"))
        let board = CoachViewModel(), game = CloudGameModel()
        game.attach(board:board,lobby:native)
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame:CGRect(x:0,y:0,width:390,height:700),configuration:config)
        let window = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows.first }.first)
        window.addSubview(web)
        game.transport.webView.frame = CGRect(x:0,y:0,width:2,height:2); window.addSubview(game.transport.webView)
        defer { web.removeFromSuperview(); game.transport.webView.removeFromSuperview() }
        func js(_ text: String) async throws -> Any? { try await web.evaluateJavaScript(text) }
        func waitJS(_ expression: String) async throws {
            let end = Date().addingTimeInterval(40)
            while (try? await js(expression)) as? Bool != true {
                if Date() > end { throw NSError(domain:"WebInterop",code:1,userInfo:[NSLocalizedDescriptionKey:"Web condition timed out: \(expression)"]) }
                try await Task.sleep(for:.milliseconds(100))
            }
        }
        await native.authenticate(name:"Native\(stamp)",password:"1",confirmation:"1",registering:true)
        web.load(URLRequest(url:URL(string:"https://yisi-xiangqi-pwa.pages.dev/")!))
        do {
            try await waitJS("!!document.querySelector('[aria-label=\"网络账号\"]')")
            _ = try await js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='注册').click()")
            try await waitJS("!!document.querySelector('[aria-label=\"确认密码\"]')")
            _ = try await js("""
            (()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
            for(const [label,value] of [['网络账号','Web\(stamp)'],['网络密码','1'],['确认密码','1']]){
              const input=document.querySelector('[aria-label="'+label+'"]');setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
            })()
            """)
            _ = try await js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='注册').click()")
            try await waitJS("!!document.querySelector('[aria-label=\"账户状态\"]')")
            try await waitUntil({native.online})
            _ = try await native.call("invite",["to":"Web\(stamp)","side":"red","minutes":15,"swapSides":true])
            try await waitJS("!!document.querySelector('[aria-label=\"对战邀请\"]')")
            _ = try await js("Array.from(document.querySelectorAll('[aria-label=\"对战邀请\"] button')).find(b=>b.textContent==='接受').click()")
            try await waitUntil({game.connected})
            board.tap(file:0,rank:6); game.publishSelection()
            try await waitJS("!!document.querySelector('.piece.peer-selected')")
            board.play("a3a4"); game.publishBoard()
            try await waitJS("document.querySelector('.piece.red[aria-label=\"红兵\"]').style.top.startsWith('44.444')")
            _ = try await js("document.querySelector('.piece.black[aria-label=\"黑卒\"]').click()")
            try await waitUntil({board.peerSquare == "a6"})
            _ = try await js("document.querySelector('[aria-label=\"棋盘 0,4\"]').click()")
            try await waitUntil({board.activePly == 2})
            XCTAssertTrue(board.canHumanMove,"Native red should regain its turn")
            await game.operation("leave")
            try await waitJS("!document.querySelector('[aria-label=\"对局操作区\"]')")
            _ = try await js("(()=>{const el=document.querySelector('[aria-label=\"账户状态\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'logout');el.dispatchEvent(new Event('change',{bubbles:true}));})()")
            await native.logout()
            NSLog("MOBILE TEST: native/published web invitation, selection, bidirectional moves and leave verified")
        } catch {
            await game.operation("leave"); await native.logout()
            throw error
        }
    }
    func testWaitingBoardKeepsFullColorAndCannotTouch() throws {
        let board = CoachViewModel()
        board.configureNetwork(active:true,side:.red)
        board.networkConnected = true
        func render() throws -> Data {
            let renderer = ImageRenderer(content:XiangqiBoardView(viewModel:board).frame(width:360,height:470))
            return try XCTUnwrap(renderer.uiImage?.pngData())
        }
        let active = try render()
        board.networkConnected = false
        let waiting = try render()
        XCTAssertEqual(active,waiting,"Waiting must not fade the pieces")
        board.tap(file:0,rank:6)
        XCTAssertNil(board.selectedSquare)
        XCTAssertFalse(board.canHumanMove)
    }
    func testCloudMatchmakingAndCancel() async throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let a = CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.match.a"))
        let b = CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.match.b"))
        await a.authenticate(name:"Match\(stamp)A",password:"1",confirmation:"1",registering:true)
        await b.authenticate(name:"Match\(stamp)B",password:"1",confirmation:"1",registering:true)
        do {
            try await waitUntil({a.online && b.online})
            _ = try await a.call("match/join",["minutes":15])
            try await waitUntil({a.matching})
            _ = try await a.call("match/leave")
            try await waitUntil({!a.matching})
            _ = try await a.call("match/join",["minutes":15])
            _ = try await b.call("match/join",["minutes":15])
            try await waitUntil({a.gameID != nil && b.gameID == a.gameID})
            XCTAssertFalse(a.matching); XCTAssertFalse(b.matching)
            XCTAssertTrue(a.engaged); XCTAssertTrue(b.engaged)
            _ = try await a.call("leave",["gameId":a.gameID!])
            try await waitUntil({!b.engaged})
            NSLog("MOBILE TEST: deployed matchmaking queue, cancel and pairing verified")
            await a.logout(); await b.logout()
        } catch {
            if let id = a.gameID { _ = try? await a.call("leave",["gameId":id]) }
            await a.logout(); await b.logout(); throw error
        }
    }
    func testSpectatorReadOnlyAndLiveSelection() async throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let players = (0..<3).map { CloudLobbyModel(client:CloudAccountClient(service:"com.yisi.xiangqicoach.tests.watch.\($0)")) }
        let a = players[0], b = players[1], c = players[2]
        let boards = (0..<3).map { _ in CoachViewModel() }
        let games = (0..<3).map { _ in CloudGameModel() }
        let window = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows.first }.first)
        for i in 0..<3 {
            games[i].transport.webView.frame = CGRect(x:i*4,y:0,width:2,height:2)
            window.addSubview(games[i].transport.webView)
            games[i].attach(board:boards[i],lobby:players[i])
            await players[i].authenticate(name:"Watch\(stamp)\(i)",password:"1",confirmation:"1",registering:true)
            XCTAssertNotNil(players[i].account,players[i].message)
        }
        do {
            try await waitUntil({players.allSatisfy { $0.online }})
            _ = try await c.call("friends/add",["name":a.account!.name])
            _ = try await a.call("friends/respond",["name":c.account!.name,"accept":true])
            let invite = try await a.call("invite",["to":b.account!.name,"side":"red","minutes":10,"swapSides":true])
            _ = try await b.call("respond",["id":invite["id"]!,"accept":true])
            try await waitUntil({games[0].connected && games[1].connected})
            boards[0].play("a3a4"); games[0].publishBoard()
            try await waitUntil({boards[1].activePly == 1})
            try await Task.sleep(for:.seconds(2))
            await games[2].watch(a.account!.name)
            try await waitUntil({boards[2].activePly == 1})
            XCTAssertTrue(boards[2].networkWatching)
            XCTAssertFalse(boards[2].canHumanMove)
            boards[2].tap(file:0,rank:3)
            XCTAssertNil(boards[2].selectedSquare)
            boards[1].tap(file:0,rank:3); games[1].publishSelection()
            try await waitUntil({boards[2].peerSquare == "a6"})
            boards[1].play("a6a5"); games[1].publishBoard()
            try await waitUntil({boards[2].activePly == 2})
            XCTAssertEqual(boards[2].cloudPosition,boards[0].cloudPosition)
            XCTAssertNil(boards[2].peerSquare)
            NSLog("MOBILE TEST: spectator selection, moves and read-only verified")
            await games[0].operation("leave")
            try await waitUntil({!boards[2].networkActive})
            for player in players { await player.logout() }
        } catch {
            await games[0].operation("leave"); games[2].leaveLocally()
            for player in players { await player.logout() }
            throw error
        }
    }
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
            try await Task.sleep(for:.seconds(2))
            await gameA.operation("time/offer")
            try await waitUntil({gameB.request == "time"})
            await gameB.operation("time/respond",accept:true)
            try await waitUntil({(gameA.clock["limit"] as? Double ?? 0) == 1200000})
            await gameA.operation("undo/offer")
            try await waitUntil({gameB.request == "undo"})
            await gameB.operation("undo/respond",accept:false)
            XCTAssertEqual(boardA.activePly,3)
            await gameA.operation("undo/offer")
            try await waitUntil({gameB.request == "undo"})
            await gameB.operation("undo/respond",accept:true)
            try await waitUntil({boardA.activePly == 2 && boardB.activePly == 2})
            XCTAssertEqual(boardA.cloudPosition,boardB.cloudPosition)
            await gameA.operation("draw/offer")
            try await waitUntil({gameB.request == "draw"})
            await gameB.operation("draw/respond",accept:false)
            XCTAssertNil(gameA.roundResult)
            NSLog("MOBILE TEST: time, accepted/rejected undo, rejected draw verified")
            let firstGame = a.gameID
            await gameA.operation("draw/offer")
            try await waitUntil({gameB.request == "draw"})
            await gameB.operation("draw/respond",accept:true)
            try await waitUntil({gameA.roundResult == "draw" && gameB.roundResult == "draw"})
            XCTAssertFalse(boardA.canHumanMove); XCTAssertFalse(boardB.canHumanMove)
            await a.refreshHistory()
            XCTAssertTrue(a.history.contains { $0["id"] as? String == firstGame && $0["result"] as? String == "draw" })
            await gameA.operation("rematch")
            try await Task.sleep(for:.seconds(1))
            XCTAssertEqual(a.gameID,firstGame,"单方确认不能开始下一局")
            await gameB.operation("rematch")
            try await waitUntil({a.gameID != firstGame && gameA.connected && gameB.connected})
            XCTAssertEqual(boardA.networkSide,.black); XCTAssertEqual(boardB.networkSide,.red)
            XCTAssertTrue(boardA.boardFlipped); XCTAssertFalse(boardB.boardFlipped)
            XCTAssertEqual(boardA.activePly,0); XCTAssertEqual(boardB.activePly,0)
            boardB.play("a3a4"); gameB.publishBoard()
            try await waitUntil({boardA.activePly == 1})
            boardA.play("a6a5"); gameA.publishBoard()
            try await waitUntil({boardB.activePly == 2})
            try await Task.sleep(for:.seconds(2))
            let secondGame = a.gameID
            await gameA.operation("resign")
            try await waitUntil({gameA.roundResult == "red" && gameB.roundResult == "red"})
            XCTAssertEqual(gameA.stats?["losses"] as? Int,1)
            XCTAssertEqual(gameB.stats?["wins"] as? Int,1)
            await a.refreshRating(); await b.refreshRating()
            XCTAssertEqual(a.account?.rating,1184)
            XCTAssertEqual(b.account?.rating,1216)
            XCTAssertEqual(a.account?.games,2)
            NSLog("MOBILE TEST: draw acceptance, swapped replay and resign stats verified")
            await gameA.operation("leave")
            try await waitUntil({!boardB.networkActive})
            await a.refreshHistory(); XCTAssertFalse(a.history.isEmpty)
            XCTAssertTrue(a.history.contains { $0["id"] as? String == secondGame && $0["result"] as? String == "red" })
            await a.saveRecord(boardA.cloudRecord,title:"移动端联调棋谱")
            XCTAssertFalse(a.records.isEmpty,a.message)
            let saved = try await a.call("records/get",["id":a.records.first!["id"]!])
            let replay = try CloudRecordCodec.decode(try XCTUnwrap(saved["content"] as? [String: Any]))
            XCTAssertEqual(replay.moves.count,2)
            NSLog("MOBILE TEST: cloud record saved and downloaded")
            await a.logout(); await b.logout()
        } catch {
            await gameA.operation("leave"); await a.logout(); await b.logout()
            throw error
        }
    }
}
