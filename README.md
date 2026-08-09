# 弈思 · 象棋思考教练

弈思是一款以“帮助棋手理解局面和候选着”为核心的中国象棋分析工具。本仓库同时提供 HTML、iOS 和 Android 三个版本：三者共享相同的交互逻辑和评分视角，并由 [Pikafish](https://github.com/official-pikafish/Pikafish) 与 NNUE 网络在本地完成合法着生成、局面评分和候选着分析。

手机版是原生应用，不是 WebView 封装。iOS 通过 SwiftUI 和 Objective-C++ 桥接 Pikafish，Android 通过原生 View/Canvas 和 JNI 调用 Pikafish。手机版的引擎与 NNUE 均随应用打包，安装后无需联网即可使用。

## 主要功能

- 完整的中国象棋行棋规则，包括马腿、炮架、将帅照面和自陷将军等合法性检查
- 分析深度可选 `8 / 10 / 12 / 14 / 16`，默认为 12
- 展示全局候选着、选中棋子的候选着、当前评分、走后评分和后续主变化
- 用带序号的棋盘箭头显示前四个候选着
- 评分统一使用红方视角：正数表示红方占优，负数表示黑方占优
- 局势图按每个半回合记录评分，可回到历史局面并从该处创建新分支
- 分析时仍可行棋；局面变化后会取消旧任务并分析新局面
- 一键切换红方或黑方视角，棋子、路数、落点和候选箭头会同步旋转
- 支持悔棋、重开、走法记录、候选着详情和双击候选直接落子

## 仓库结构

```text
.
├── html/       HTML 版，基于 React、vinext 和 Vite
├── iOS/        SwiftUI 应用、Objective-C++ 桥接和 Pikafish 源码
├── android/    Android 原生应用、JNI 桥接和 Gradle 工程
└── README.md   项目总览与安装说明
```

本文下面的命令均在仓库根目录执行。

## HTML 版

### 环境要求

- Node.js `22.13.0` 或更高版本
- npm
- 首次安装原生 Pikafish 时需要 Git、C++ 编译工具、Make 和网络连接
- `engine:setup` 脚本目前面向 macOS，并自动区分 Apple Silicon 和 Intel 处理器

### 安装与运行

1. 安装 JavaScript 依赖：

   ```bash
   npm --prefix html install
   ```

2. 首次使用时下载并编译原生 Pikafish，同时下载 NNUE：

   ```bash
   npm --prefix html run engine:setup
   ```

   引擎会安装到 `html/.local/pikafish/`。此步完成后，日常使用不需要重复下载。

3. 同时启动原生引擎服务和 HTML 开发服务器：

   ```bash
   npm --prefix html run local
   ```

4. 在浏览器打开 <http://localhost:3000/>。

`local` 命令会在 `127.0.0.1:8788` 启动多线程 Pikafish 服务，并启动网页开发服务器。页面优先使用原生引擎；原生服务不可用时，会尝试随网页提供的 WASM 引擎。

### 其他 HTML 命令

```bash
npm --prefix html run dev      # 只启动网页开发服务器
npm --prefix html run build    # 生成生产构建
npm --prefix html run start    # 启动已构建的生产版
npm --prefix html test         # 构建并运行页面功能测试
npm --prefix html run lint     # 运行 ESLint
```

更多 HTML 实现说明见 [`html/README.md`](html/README.md)。

## iOS 版

iOS 版是 SwiftUI 原生应用。Pikafish C++ 源码通过 Objective-C++ 桥接直接编译进 App，`pikafish.nnue` 也会被打包进应用。

### 环境要求

- macOS 与 Xcode
- iOS 17 或更高版本的真机，或 Xcode 中已安装的 iOS Simulator
- 真机安装需要在 Xcode 中选择 Apple Developer Team

### 使用 Xcode 运行

1. 打开工程：

   ```bash
   open iOS/YisiXiangqiCoach.xcodeproj
   ```

2. 在 Xcode 中选择 `YisiXiangqiCoach` scheme。
3. 如果使用真机，在 **Signing & Capabilities** 中选择自己的 Team。
4. 选择 iPhone 或 iOS Simulator，然后点击 **Run**。

### 命令行构建

下列命令会构建 `iphoneos` 目标，但不进行代码签名，适合用于验证工程是否能够编译：

```bash
xcodebuild -project iOS/YisiXiangqiCoach.xcodeproj \
  -scheme YisiXiangqiCoach \
  -configuration Debug \
  -sdk iphoneos \
  -derivedDataPath iOS/build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  SUPPORTED_PLATFORMS=iphoneos \
  build
```

在 Apple Silicon Mac 上可以直接验证 Objective-C++ 桥接、合法着生成、走法执行和 NNUE 分析：

```bash
iOS/run_bridge_smoke.sh
```

更多实现和签名说明见 [`iOS/README.md`](iOS/README.md)。

## Android 版

Android 版使用 Java 与原生 View/Canvas 实现界面，通过 JNI 调用由 Android NDK 编译的 Pikafish。构建时会从 `iOS/` 目录共享 Pikafish 源码、NNUE、图标和许可证，因此请保持完整的仓库目录结构。

### 环境要求

- Android Studio，或已正确配置的 Android SDK 命令行环境
- JDK 17
- Android SDK Platform 35
- Android NDK 与 CMake `3.22.1`
- 运行设备需 Android 8.0（API 26）或更高版本
- 当前构建目标为 `arm64-v8a`

### 使用 Android Studio 运行

1. 在 Android Studio 中打开仓库下的 `android` 目录。
2. 等待 Gradle Sync 完成；如果 Android Studio 提示缺少 SDK、NDK 或 CMake，按提示安装。
3. 连接开启 USB 调试的 arm64 Android 设备。
4. 选择 `app` 配置并点击 **Run**。

### 命令行构建与安装

使用仓库自带的 Gradle Wrapper 构建调试 APK：

```bash
android/gradlew -p android assembleDebug
```

构建结果位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

连接已开启 USB 调试的设备后，可通过 ADB 安装或更新：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

更多 Android 实现说明见 [`android/README.md`](android/README.md)。

## 快速验证全部版本

安装好各平台所需工具后，可从仓库根目录依次运行：

```bash
# HTML
npm --prefix html test

# iOS（不签名）
xcodebuild -project iOS/YisiXiangqiCoach.xcodeproj \
  -scheme YisiXiangqiCoach -configuration Debug -sdk iphoneos \
  -derivedDataPath iOS/build/DerivedData \
  CODE_SIGNING_ALLOWED=NO SUPPORTED_PLATFORMS=iphoneos build
iOS/run_bridge_smoke.sh

# Android
android/gradlew -p android assembleDebug
```

## 常见问题

### HTML 提示 Pikafish 未安装

运行 `npm --prefix html run engine:setup`。确认 `html/.local/pikafish/` 下同时存在 `pikafish` 和 `pikafish.nnue`。

### `3000` 或 `8788` 端口已被占用

检查是否已经启动了另一个 `npm run local` 实例。HTML 开发服务器使用端口 `3000`，本地 Pikafish 服务使用 `127.0.0.1:8788`。

### iOS 真机无法安装

在 Xcode 中检查 Bundle Identifier、Developer Team 和设备开发者模式。命令行的无签名构建只用于编译验证，不能直接安装到 iPhone。

### Android 找不到 Pikafish 源码或 NNUE

请从完整的仓库根目录构建，不要单独复制 `android/` 目录。Android 工程会引用 `iOS/ThirdParty/Pikafish/` 和 `iOS/App/Resources/`中的共享文件。

## 离线使用与隐私

- iOS 和 Android 版在构建时将引擎和 NNUE 打包进应用，运行期无需访问网络。
- HTML 版只在首次执行 `engine:setup` 时需要下载 Pikafish 和 NNUE；之后可使用本地引擎。
- 局面分析由用户设备上的 Pikafish 完成，不依赖远程象棋分析 API。

## 开源许可

项目内置的 Pikafish 固定于提交 `b21805624cead52b308f576fc10de7f0e27b984f`，并按 GPL-3.0 发布。相关许可证与来源说明见：

- [`iOS/ThirdParty/Pikafish/COPYING.txt`](iOS/ThirdParty/Pikafish/COPYING.txt)
- [`html/public/pikafish/COPYING.txt`](html/public/pikafish/COPYING.txt)
- [`html/public/pikafish/SOURCE.md`](html/public/pikafish/SOURCE.md)
