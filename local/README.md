# 本地运行版（local）

计算引擎和 NNUE 模型保存在本机；账号、好友、联网对局、对局历史和个人云端棋谱使用与在线网页版相同的云端服务和数据库。

## 推荐：直接运行桌面应用

macOS 双击 `macos/弈思象棋.app`；Windows 运行 `windows/` 中的安装程序。应用无需 Node.js，内置本地引擎，联网账号与网页版互通。公共源码、界面和引擎资源保留在本目录根层；平台专用入口和安装包分别放入 `macos`、`windows`。

## 可选：浏览器运行方式

安装 Node.js 22 或更新版本。无需另外运行账号服务器，也不需要玩家填写服务器地址。

- macOS：双击 `macos/启动联网版.command`。
- Windows：双击 `windows/启动联网版.bat`。
- 或在当前文件夹运行 `npm run local`。

浏览器自动打开 `http://localhost:8080/`。本地服务仅监听本机，不向局域网开放；保持启动窗口打开，关闭窗口即停止服务。8080 被占用时，先关闭原本地服务。Linux 的启动命令已提供，但尚未验证。

联网功能包括注册自动登录、异端登录挤下旧端、唯一数字 ID、好友申请和搜索、邀请执棋设置、联网对局计时、协商悔棋 / 提和 / 加时、认输、好友观战、云端历史与复盘。账号与在线网页版互通，不另建本地账号数据库。联网对战期间禁止实时引擎提示；退出后可用本地引擎复盘。

## 仅使用本地功能

双击 `index.html` 可使用本地引擎、对弈分析和人机对战，不需要 Node.js 或联网。`file://` 模式不提供账号和网络对战；需要联网功能时使用上述本地启动入口。

保留完整文件夹，尤其不要删除 `engine-data.js`、`pikafish.js`、`app.js` 和 `style.css`。

## 开发验证

在仓库根目录执行：

```sh
npm --prefix local install
npm --prefix local run build
npm --prefix local test
npm --prefix local run local
```

本地运行版与 `web` 共享账号和网络对战模块，避免两套功能出现差异。
# 桌面安装包

桌面版与此目录的本地引擎、界面共用代码。macOS 应用位于 `macos/弈思象棋.app`；Windows 安装程序位于 `windows/`，运行后不需要 Node.js。安装包由 `desktop` 打包工程生成，GitHub Actions 的 Desktop packages 提供两个平台的下载。
