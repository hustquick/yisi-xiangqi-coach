# 弈思 · 象棋思考教练

项目目录下包含同一套象棋教练的 HTML、iOS 和 Android 版本。三个版本都使用本地 Pikafish 和随包 NNUE。

以下命令均在本仓库根目录执行。

## HTML

```bash
npm --prefix html install
npm --prefix html run engine:setup  # 首次需联网
npm --prefix html run local
```

打开 `http://localhost:3000/`。单独验证生产构建可运行 `npm --prefix html run build`。更多说明见 [`html/README.md`](html/README.md)。

## iOS

```bash
open iOS/YisiXiangqiCoach.xcodeproj
```

在 Xcode 中选择签名团队和设备后运行。命令行构建和桥接层冒烟测试见 [`iOS/README.md`](iOS/README.md)。

## Android

```bash
android/gradlew -p android assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

详细的 Android Studio 和设备说明见 [`android/README.md`](android/README.md)。
