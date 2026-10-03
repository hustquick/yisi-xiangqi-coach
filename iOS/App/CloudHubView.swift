import SwiftUI

struct CloudHubView: View {
    @ObservedObject var lobby: CloudLobbyModel
    var friendsPage: Bool
    var review: ([String: Any]) -> Void = { _ in }
    @State private var name = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var query = ""
    @State private var newName = ""
    @State private var registering = false
    @State private var showRename = false

    var body: some View {
        NavigationStack {
            Group {
                if let account = lobby.account {
                    if friendsPage { friendsList }
                    else { accountList(account) }
                } else { loginForm }
            }
            .navigationTitle(friendsPage ? "棋友" : "我的")
            .safeAreaInset(edge: .bottom) {
                if !lobby.message.isEmpty {
                    HStack {
                        Text(lobby.message).font(.footnote).accessibilityLabel(lobby.message)
                        Spacer()
                        Button { lobby.message = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .accessibilityLabel("关闭提示")
                    }.padding().background(.regularMaterial)
                }
            }
            .task {
                if lobby.account != nil {
                    if friendsPage { await lobby.refreshFriends() }
                    else { await lobby.refreshHistory(); await lobby.refreshRecords() }
                }
            }
        }.tint(Color(red: 0.10, green: 0.34, blue: 0.25))
    }

    private var loginForm: some View {
        Form {
            Section {
                Label("同一个账号，棋谱随身", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.headline)
                TextField("账号", text: $name).textContentType(.username).autocorrectionDisabled().textInputAutocapitalization(.never)
                SecureField("密码", text: $password).textContentType(registering ? .newPassword : .password)
                if registering { SecureField("确认密码", text: $confirmation).textContentType(.newPassword) }
                HStack {
                    Button(registering ? "已有账号，登录" : "登录") {
                        if registering { registering = false; confirmation = "" }
                        else { authenticate() }
                    }.buttonStyle(.bordered).disabled(lobby.working)
                    Button(registering ? "注册" : "创建账号") {
                        if registering { authenticate() }
                        else { registering = true }
                    }.buttonStyle(.borderedProminent).disabled(lobby.working)
                    if lobby.working { ProgressView() }
                }.padding(.vertical, 4)
            } footer: { Text("与网页版和桌面版共用账号。注册成功自动登录，后续自动恢复登录状态。") }
        }
    }
    private func authenticate() {
        Task {
            await lobby.authenticate(name: name, password: password, confirmation: confirmation, registering: registering)
            if lobby.account != nil { password = ""; confirmation = ""; await lobby.refreshFriends() }
        }
    }
    private var friendsList: some View {
        List {
            Section {
                HStack {
                    TextField("名称或数字 ID", text: $query).autocorrectionDisabled().textInputAutocapitalization(.never)
                        .onSubmit { Task { await lobby.search(query) } }
                    Button { Task { await lobby.search(query) } } label: { Image(systemName: "magnifyingglass") }
                        .accessibilityLabel("搜索棋友")
                }
            }
            if !lobby.requests.isEmpty {
                Section("好友申请") {
                    ForEach(lobby.requests) { person in
                        VStack(alignment: .leading, spacing: 8) {
                            identity(person)
                            HStack {
                                Button("同意") { Task { await lobby.action("friends/respond", ["name": person.name, "accept": true]); await lobby.refreshFriends() } }.buttonStyle(.borderedProminent)
                                Button("拒绝") { Task { await lobby.action("friends/respond", ["name": person.name, "accept": false]) } }.buttonStyle(.bordered)
                            }
                        }.padding(.vertical, 5)
                    }
                }
            }
            if !lobby.results.isEmpty {
                Section("搜索结果") { ForEach(lobby.results) { person in personRow(person, isFriend: person.added) } }
            }
            Section("好友 · \(lobby.friends.count)") {
                if lobby.friends.isEmpty { Text("搜索账号或 ID，找到棋友").foregroundStyle(.secondary) }
                ForEach(lobby.friends) { person in personRow(person, isFriend: true) }
            }
        }.refreshable { await lobby.refreshFriends() }
    }
    private func identity(_ person: CloudLobbyModel.Person) -> some View {
        HStack {
            Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(person.nickname).font(.headline)
                Text("ID \(person.id)").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(person.online ? person.busy ? "对局中" : "在线" : "离线")
                .font(.caption).foregroundStyle(person.online ? .green : .secondary)
        }
    }
    private func personRow(_ person: CloudLobbyModel.Person, isFriend: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            identity(person)
            HStack {
                if !isFriend {
                    Button("添加好友") { Task { await lobby.action("friends/add", ["name": person.name], success: "好友申请已发送") } }.buttonStyle(.bordered)
                }
                if isFriend {
                    Menu {
                        Button("查看双方历史") { Task { await lobby.refreshHistory(opponentID: person.id) } }
                        Button("移除好友", role: .destructive) { Task { await lobby.action("friends/remove", ["name": person.name]); await lobby.refreshFriends() } }
                    } label: { Label("好友信息", systemImage: "ellipsis.circle") }
                }
            }
        }.padding(.vertical, 6)
    }
    private func accountList(_ account: CloudAccountClient.Session) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(account.nickname)（\(account.id)）").font(.title3.bold())
                    Text(lobby.online ? "已连接" : "正在连接").font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 6)
                Picker("账户状态", selection: Binding(get: { account.presence }, set: { value in Task { await lobby.changePresence(value) } })) {
                    Text("在线").tag("online"); Text("隐身").tag("invisible"); Text("退出").tag("logout")
                }
                Button("修改名称") { newName = account.nickname; showRename = true }
            }
            Section("对局历史") {
                if lobby.history.isEmpty { Text("暂无已完成对局").foregroundStyle(.secondary) }
                ForEach(Array(lobby.history.enumerated()), id: \.offset) { _, game in
                    historyRow(game)
                }
            }
            Section("云端棋谱") {
                if lobby.records.isEmpty { Text("暂无云端棋谱").foregroundStyle(.secondary) }
                ForEach(Array(lobby.records.enumerated()), id: \.offset) { _, record in
                    Button(record["title"] as? String ?? "棋谱") {
                        Task { if let value = try? await lobby.call("records/get", ["id": record["id"] as? String ?? ""]), let content = value["content"] as? [String: Any] { review(content) } }
                    }
                }
            }
        }
        .refreshable { await lobby.refreshHistory(); await lobby.refreshRecords() }
        .alert("修改名称", isPresented: $showRename) {
            TextField("新名称", text: $newName)
            Button("保存") { Task { await lobby.rename(newName) } }
            Button("取消", role: .cancel) {}
        }
    }
    private func historyRow(_ game: [String: Any]) -> some View {
        let opponent = game["opponent"] as? [String: Any] ?? [:]
        return VStack(alignment: .leading, spacing: 5) {
            Text("对阵 \(opponent["nickname"] as? String ?? "棋友")").font(.headline)
            Text("\(game["result"] as? String ?? "") · 用时 \(Int((game["duration"] as? Double ?? 0) / 60000)) 分钟").font(.caption).foregroundStyle(.secondary)
            if game["hasRecord"] as? Bool == true {
                Button("复盘分析") {
                    Task { if let value = try? await lobby.call("history/get", ["id": game["id"] as? String ?? ""]), let content = value["content"] as? [String: Any] { review(content) } }
                }
            }
        }.padding(.vertical, 5)
    }
}
