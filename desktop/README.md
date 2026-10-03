# 弈思象棋桌面版

应用内运行本地皮卡鱼引擎，联网共用网页版账号、好友、对战、观战与云端历史。运行安装包不需要 Node.js。首次版本未进行 Apple 公证及 Windows 代码签名，系统可能提示未知开发者；仅使用可信来源的安装包。

开发与打包需要 Node.js、Rust 和对应平台的 Tauri 系统依赖：

```sh
npm --prefix local ci
npm --prefix local run build
npm --prefix desktop ci
npm --prefix desktop run build
```

安装包自动收集到 `local/macos`（`.app` / `.dmg`）和 `local/windows`（`.exe` / `.msi`）。Windows 需在 Windows 构建；GitHub Actions 提供两平台打包和下载。不将 Mac 构建结果宣称为已验证的 Windows 安装包。
