import SwiftUI

struct CloudHubView: View {
    @ObservedObject var lobby: CloudLobbyModel
    var friendsPage: Bool
    var review: ([String: Any]) -> Void = { _ in }
    var watch: (String) -> Void = { _ in }
    var currentRecord: () -> [String: Any] = { [:] }
    @State private var name = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var query = ""
    @State private var newName = ""
    @State private var registering = false
    @State private var showRename = false
    @AppStorage("cloud.invite.minutes") private var minutes = 15
    @AppStorage("cloud.invite.side") private var side = "red"
    @AppStorage("cloud.invite.swapSides") private var swapSides = true
    @State private var historySheet = false
    @State private var removeFriend: CloudLobbyModel.Person?
    @State private var recordTitle = ""
    @State private var showSaveRecord = false

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
            .sheet(isPresented: $historySheet) {
                NavigationStack {
                    List { ForEach(Array(lobby.history.enumerated()),id:\.offset) { _, game in historyRow(game) } }
                        .navigationTitle("双方历史")
                        .toolbar { Button("完成") { historySheet = false } }
                }
            }
            .confirmationDialog("移除这位好友？", isPresented: Binding(get: { removeFriend != nil }, set: { if !$0 { removeFriend = nil } })) {
                if let friend = removeFriend { Button("移除好友",role:.destructive) { Task { await lobby.action("friends/remove",["name":friend.name]); await lobby.refreshFriends() } } }
            }
            .task(id: lobby.account?.name) {
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
        ScrollViewReader { proxy in List {
            if let invitation = lobby.invitation {
                Section("对战邀请") {
                    let profile = invitation["fromProfile"] as? [String: Any] ?? [:]
                    Text("\(profile["nickname"] as? String ?? invitation["from"] as? String ?? "棋友") 邀请你对战").font(.headline)
                    Text("每方 \(invitation["minutes"] as? Int ?? 15) 分钟 · 你执\(invitation["side"] as? String == "red" ? "黑" : "红") · \(invitation["swapSides"] as? Bool == false ? "固定执棋" : "交替执棋")").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("接受对战") { Task { await lobby.action("respond",["id":invitation["id"] ?? "","accept":true]) } }.buttonStyle(.borderedProminent)
                        Button("拒绝") { Task { await lobby.action("respond",["id":invitation["id"] ?? "","accept":false]); lobby.invitation = nil } }.buttonStyle(.bordered)
                    }
                }.id("incoming-invitation")
            }
            if !lobby.engaged {
                Section("网络对战") {
                    HStack {
                        ForEach([5,10,15],id:\.self) { value in
                            Button("\(value) 分钟") { minutes = value }
                                .buttonStyle(.bordered).tint(minutes == value ? .green : .secondary)
                        }
                        Menu("更多") { ForEach([30,45],id:\.self) { value in Button("\(value) 分钟") { minutes = value } } }
                    }.disabled(lobby.matching)
                    if minutes > 15 { Text("每方 \(minutes) 分钟").font(.caption) }
                    if lobby.matching {
                        HStack { ProgressView(); Text("等待 \(minutes) 分钟对局…"); Spacer(); Button("取消") { Task { await lobby.action("match/leave") } } }
                    } else {
                        Button { Task { await lobby.action("match/join",["minutes":minutes],success:"正在匹配…") } } label: { Label("自动匹配",systemImage:"shuffle") }
                            .disabled(!lobby.online)
                    }
                    Picker("本局执棋",selection:$side) { Text("执红").tag("red"); Text("执黑").tag("black") }.pickerStyle(.segmented)
                    Toggle("下一局交替执棋",isOn:$swapSides)
                }
            }
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
            .onChange(of:lobby.invitation?["id"] as? String) { _,id in
                if id != nil { withAnimation { proxy.scrollTo("incoming-invitation",anchor:.top) } }
            }
        }
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
                if person.online && !person.busy {
                    Button("邀请对战") { Task { await lobby.action("invite",["to":person.name,"side":side,"swapSides":swapSides,"minutes":minutes],success:"邀请已发出，等待应战") } }
                        .buttonStyle(.borderedProminent).disabled(lobby.engaged || lobby.matching)
                }
                if isFriend && person.online && person.busy {
                    Button("观看对弈") { watch(person.name) }.buttonStyle(.borderedProminent).disabled(lobby.engaged || lobby.matching)
                }
                if !isFriend {
                    Button("添加好友") { Task { await lobby.action("friends/add", ["name": person.name], success: "好友申请已发送") } }.buttonStyle(.bordered)
                }
                if isFriend {
                    Menu {
                        Button("查看双方历史") { Task { await lobby.refreshHistory(opponentID: person.id); historySheet = true } }
                        Button("移除好友", role: .destructive) { removeFriend = person }
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
                Button { recordTitle = "我的棋谱"; showSaveRecord = true } label: {
                    Label("保存当前棋谱到云端",systemImage:"icloud.and.arrow.up")
                }.disabled(lobby.engaged || lobby.working)
                if lobby.records.isEmpty { Text("暂无云端棋谱").foregroundStyle(.secondary) }
                ForEach(Array(lobby.records.enumerated()), id: \.offset) { _, record in
                    Button(record["title"] as? String ?? "棋谱") {
                        Task { if let value = try? await lobby.call("records/get", ["id": record["id"] as? String ?? ""]), let content = value["content"] as? [String: Any] { review(content) } }
                    }.disabled(lobby.engaged)
                }
            }
        }
        .refreshable { await lobby.refreshHistory(); await lobby.refreshRecords() }
        .alert("修改名称", isPresented: $showRename) {
            TextField("新名称", text: $newName)
            Button("保存") { Task { await lobby.rename(newName) } }
            Button("取消", role: .cancel) {}
        }
        .alert("保存云端棋谱",isPresented:$showSaveRecord) {
            TextField("棋谱名称",text:$recordTitle)
            Button("保存") { Task { await lobby.saveRecord(currentRecord(),title:recordTitle) } }
            Button("取消",role:.cancel) {}
        }
    }
    private func historyRow(_ game: [String: Any]) -> some View {
        let opponent = game["opponent"] as? [String: Any] ?? [:]
        return VStack(alignment: .leading, spacing: 5) {
            Text("对阵 \(opponent["nickname"] as? String ?? "棋友")").font(.headline)
            Text("\(historyResult(game)) · 用时 \(historyDuration(game))").font(.caption).foregroundStyle(.secondary)
            if game["hasRecord"] as? Bool == true {
                Button("复盘分析") {
                    Task { if let value = try? await lobby.call("history/get", ["id": game["id"] as? String ?? ""]), let content = value["content"] as? [String: Any] { review(content) } }
                }.disabled(lobby.engaged)
            }
        }.padding(.vertical, 5)
    }
    private func historyResult(_ game: [String: Any]) -> String {
        let result = game["result"] as? String ?? ""
        if result == "draw" { return "和棋" }
        if result == "red" || result == "black" { return result == game["side"] as? String ? "获胜" : "失利" }
        return result == "进行中" ? result : "已结束"
    }
    private func historyDuration(_ game: [String: Any]) -> String {
        let seconds = Int((game["duration"] as? Double ?? 0)/1000)
        return String(format:"%02d:%02d",seconds/60,seconds%60)
    }
}
