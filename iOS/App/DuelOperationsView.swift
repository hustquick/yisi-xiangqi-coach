import SwiftUI

struct DuelOperationsView: View {
    @ObservedObject var duel: CloudGameModel
    @ObservedObject var lobby: CloudLobbyModel
    @ObservedObject var board: CoachViewModel
    @State private var confirmation: String?
    var body: some View {
        VStack(spacing:10) {
            if !duel.status.isEmpty {
                Text(duel.status).font(.footnote).foregroundStyle(duel.peerOffline ? .orange : .secondary)
                    .frame(maxWidth:.infinity,alignment:.leading)
            }
            if let request = duel.request {
                HStack {
                    Text(request == "draw" ? "对方提和" : request == "undo" ? "对方申请悔棋" : "双方各加时五分钟").font(.subheadline.bold())
                    Spacer()
                    Button("同意") { Task { await duel.operation("\(request)/respond",accept:true) } }.buttonStyle(.borderedProminent)
                    Button("拒绝") { Task { await duel.operation("\(request)/respond",accept:false) } }.buttonStyle(.bordered)
                }.padding(12).background(Color.orange.opacity(0.12),in:RoundedRectangle(cornerRadius:14))
                    .id("duel-requests")
            }
            if let result = duel.roundResult {
                Text(result == "draw" ? "本局和棋" : result == board.networkSide.rawValue ? "本局获胜" : "本局失利").font(.headline)
                if let stats = duel.stats {
                    Text("累计 \(stats["total"] as? Int ?? 0) 局 · \(stats["wins"] as? Int ?? 0) 胜 / \(stats["losses"] as? Int ?? 0) 负 / \(stats["draws"] as? Int ?? 0) 和")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack {
                if board.networkWatching {
                    Button("退出观战") { duel.leaveLocally() }.buttonStyle(.bordered)
                } else {
                    Menu {
                        Button("申请悔棋") { Task { await duel.operation("undo/offer") } }.disabled(board.activePly == 0 || duel.roundResult != nil)
                        Button("提和") { Task { await duel.operation("draw/offer") } }.disabled(duel.roundResult != nil)
                        Button("申请加时") { Task { await duel.operation("time/offer") } }.disabled(duel.roundResult != nil || (duel.clock["limit"] as? Double ?? 0) >= 2700000)
                        Button("认输",role:.destructive) { confirmation = "resign" }.disabled(duel.roundResult != nil)
                        Button("退出对局",role:.destructive) { confirmation = "leave" }
                    } label: { Label("对局操作",systemImage:"line.3.horizontal") }.buttonStyle(.borderedProminent)
                    Spacer()
                    if !duel.connected && duel.roundResult == nil { Button("重连") { Task { await duel.reconnect() } }.buttonStyle(.bordered) }
                }
            }
        }.padding(12).background(.regularMaterial,in:RoundedRectangle(cornerRadius:18))
        .confirmationDialog(confirmation == "resign" ? "确认认输？" : "确认退出当前对局？",isPresented:Binding(get:{confirmation != nil},set:{if !$0 {confirmation = nil}})) {
            if let action = confirmation {
                Button(action == "resign" ? "认输" : "退出对局",role:.destructive) { Task { await duel.operation(action) } }
            }
            Button("取消",role:.cancel) {}
        }
    }
}
