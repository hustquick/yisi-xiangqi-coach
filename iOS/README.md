# 弈思象棋教练 iOS

这是网页版本的原生 iOS 实现，不是 WebView 外壳。界面使用 SwiftUI，Pikafish 官方 C++ 源码通过 Objective-C++ 桥接直接编译进应用，`pikafish.nnue` 随应用打包，因此走法生成、局面评分和候选分析均可离线运行。

## 已实现

- 原生中国象棋棋盘，含黑方 `1–9`、红方 `九–一` 路数标记
- 一键红黑倒置，棋子、合法落点、候选箭头、河界和路数同步切换到对方视角，不改变行棋方或引擎局面
- 点击棋子显示全部合法落点；绿色为该棋子的皮卡鱼首选，蓝色为其他合法落点
- 马腿、炮架、将帅照面和自陷将军等合法性由 Pikafish 本身判定
- 可在主界面选择分析深度 `8 / 10 / 12 / 14 / 16`，默认深度 12；切换时立即停止旧计算，并按新深度刷新当前局面
- 全局候选、单子候选、当前局面评分和走后评分均使用当前选择的深度，并与局势图统一为红方视角：正数红优、负数黑优
- 每个局面先发布合法着法，再继续深度分析；计算候选期间仍可选子和走棋，落子会取消旧局面分析并自动分析对方应着
- 棋盘上方的圆形“优”按钮可显示或隐藏候选箭头，默认隐藏；即使只有一个候选也显示 `1` 号箭头；空目标的箭头尖端落在交叉点，有棋子的目标则停在棋子圆边但保持朝向交叉点中心，编号圆圈会在其边缘真实截断箭身，短箭头会把编号移到侧面；`1–4` 分别表示全局前四个候选着法的排名，不表示同一变化的后续步骤
- 候选箭头只使用当前局面的分析结果，计算中不显示，并且不影响棋子和合法落点操作
- 单子首选不是全局最优时，单独保留“全局最优着法”提示
- 单击候选着法弹出中文后续主变化，双击直接落子；并支持悔棋、重开、走法记录，以及包含评分变化、首选替代和随后 4 个半回合主变化的动态评价
- 局势图按每个半回合记录皮卡鱼评分：零线上方为红优，下方为黑优；点击任意点可回到该局面并从那里创建新分支。落子过快导致的缺失评分会在当前分析结束后由后台逐步补算，期间保持空缺而不是伪造 0 分
- 红黑双方各走一步计 1 回合
- 本地多线程和随包 NNUE；运行时不访问网络

## 在 Xcode 中运行

1. 从仓库根目录运行 `open iOS/YisiXiangqiCoach.xcodeproj`，或在 `iOS` 中打开 `YisiXiangqiCoach.xcodeproj`。
2. 在 Xcode 的 Signing & Capabilities 中选择自己的 Apple Developer Team。
3. 连接 iPhone 或安装 iOS Simulator 平台组件，选择设备后点击 Run。

最低系统版本为 iOS 17。工程已在 iOS 26.6 的 iPhone 14 真机完成个人团队签名、安装和启动验证，并通过 `iphoneos` arm64 完整构建。

## 命令行验证

```bash
# 构建真机目标，不签名
xcodebuild -project iOS/YisiXiangqiCoach.xcodeproj \
  -scheme YisiXiangqiCoach -configuration Debug -sdk iphoneos \
  -derivedDataPath iOS/build/DerivedData \
  CODE_SIGNING_ALLOWED=NO SUPPORTED_PLATFORMS=iphoneos build

# 在 Mac 上直接验证相同桥接层、合法着法、执行着法和本地 NNUE 分析
iOS/run_bridge_smoke.sh
```

## 开源说明

内置引擎来自官方 Pikafish，固定于提交 `b21805624cead52b308f576fc10de7f0e27b984f`。Pikafish 按 GPL-3.0 发布，许可证已收录在 `ThirdParty/Pikafish/COPYING.txt` 并随应用打包。
