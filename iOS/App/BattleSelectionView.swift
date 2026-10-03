import SwiftUI

struct BattleSelectionView: View {
    var network: () -> Void
    var choose: (GameMode) -> Void
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:22) {
                VStack(alignment:.leading,spacing:8) {
                    Text("弈思").font(.system(size:38,weight:.bold,design:.serif))
                    Text("落子有思，以棋会友").font(.subheadline).foregroundStyle(.secondary)
                }.padding(.top,20)
                Button(action:network) {
                    VStack(alignment:.leading,spacing:20) {
                        HStack { Image(systemName:"person.2.fill").font(.largeTitle); Spacer(); Image(systemName:"arrow.up.right") }
                        VStack(alignment:.leading,spacing:6) {
                            Text("网络对战").font(.title.bold())
                            Text("自动匹配 · 好友邀请 · 实时观战").font(.subheadline)
                        }
                    }.padding(24).frame(maxWidth:.infinity,alignment:.leading)
                        .foregroundStyle(.white)
                        .background(LinearGradient(colors:[Color(red:0.10,green:0.32,blue:0.24),Color(red:0.19,green:0.46,blue:0.34)],startPoint:.topLeading,endPoint:.bottomTrailing),in:RoundedRectangle(cornerRadius:26))
                }.buttonStyle(.plain)
                HStack(spacing:14) {
                    modeCard("人机对战",detail:"本地皮卡鱼",icon:"cpu",mode:.computer)
                    modeCard("对弈分析",detail:"自由行棋与复盘",icon:"chart.xyaxis.line",mode:.local)
                }
                Button { choose(.setup) } label: {
                    HStack { Image(systemName:"square.grid.3x3"); Text("摆盘研究").font(.headline); Spacer(); Image(systemName:"chevron.right") }
                        .padding(20).background(.quaternary,in:RoundedRectangle(cornerRadius:20))
                }.buttonStyle(.plain)
                Text("账号与棋谱跨设备共享，离线仍可对弈与分析。")
                    .font(.footnote).foregroundStyle(.secondary).padding(.top,8)
            }.padding(22)
        }.background(scheme == .dark ? Color(red:0.045,green:0.06,blue:0.052) : Color(red:0.97,green:0.96,blue:0.92))
    }
    private func modeCard(_ title: String,detail: String,icon: String,mode: GameMode) -> some View {
        Button { choose(mode) } label: {
            VStack(alignment:.leading,spacing:16) {
                Image(systemName:icon).font(.title).foregroundStyle(Color(red:0.17,green:0.42,blue:0.30))
                VStack(alignment:.leading,spacing:5) { Text(title).font(.headline); Text(detail).font(.caption).foregroundStyle(.secondary) }
            }.padding(20).frame(maxWidth:.infinity,minHeight:150,alignment:.leading)
                .background(.regularMaterial,in:RoundedRectangle(cornerRadius:22))
        }.buttonStyle(.plain)
    }
}
