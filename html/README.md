# 弈思 · 象棋思考教练

同一套象棋教练现有 HTML、iOS 与 Android 三个版本。三个版本都使用本地皮卡鱼和本地 NNUE，不联网也能完成局面分析。

## HTML 版

以下命令在仓库的 `html` 目录中执行：

首次准备时需要联网执行一次：

```bash
npm run engine:setup
```

该命令会把原生 C++ 皮卡鱼和 `pikafish.nnue` 下载到 `.local/pikafish/`。以后可完全离线启动：

```bash
npm run local
```

浏览器打开终端显示的网址（通常是 `http://localhost:3000/`）。页面会优先连接 `127.0.0.1:8789` 上的多线程原生皮卡鱼；本地服务不可用时才回退到浏览器 WASM 版。

原生皮卡鱼默认自动使用最多 4 个 CPU 线程。如需指定线程数，可使用 `PIKAFISH_THREADS=6 npm run local`；实际线程数不会超过机器的逻辑核心数。

HTML 版现与手机端保持主要功能一致：

- 人机对战提供十档参考 Elo；运行 `npm run local` 时由本地皮卡鱼执行 `UCI_LimitStrength`/`UCI_Elo`。纯浏览器 WASM 旧构建不伪装限强，使用等级对战时请启动本地引擎
- 分析深度可选 `8 / 10 / 12 / 14 / 16`，默认 12；切换后停止旧任务并立即重算当前局面
- 思考期间仍可行棋，落子后自动取消旧计算并分析对方应着
- 全局前五候选、点击棋子后的限定候选、当前评分和走后评分均来自皮卡鱼，并统一采用局势图的红方视角（正数红优、负数黑优）；动态评语会说明评分升降、首选替代、具体子力/线路变化，并列出随后最多 4 个半回合的主变化
- 棋盘上方圆形“优”按钮显示或隐藏前四候选的带序号箭头
- 一键切换红方/黑方视角；棋子、落点、候选箭头、河界文字和上下路数会同步旋转，棋局状态与皮卡鱼坐标保持不变
- 双击候选直接落子，并支持悔棋、重开和正确的回合计数
- 局势图按每个半回合记录红方视角评分；点击任意一步可返回当时局面并从那里创建新分支。若用户在皮卡鱼返回前已经落子，该局面先留空，当前局面分析完成后再由后台低优先级补算，不会用 0 或推测值冒充结果
- 红方视角下方标注汉字路数、上方标注阿拉伯数字路数；切换到黑方视角后自动对调

## iOS 与 Android

- iOS 构建与安装说明见 [`../iOS/README.md`](../iOS/README.md)
- Android 构建与 APK 说明见 [`../android/README.md`](../android/README.md)

## 常用命令

```bash
npm run local   # 本地原生皮卡鱼 + HTML 开发服务器
npm run build   # 验证 HTML 生产构建
npm test        # 构建并检查 HTML 主要功能
```

## PWA 与 Cloudflare Pages

在线 PWA 直接在浏览器中运行 Pikafish WebAssembly，不依赖服务器端引擎。首次访问会分段下载应用外壳、引擎和 NNUE；缓存完成后可离线启动。Cloudflare Pages 已包含多线程 WASM 所需的跨源隔离响应头。

```bash
npm install
npm run build:pwa                         # 静态产物位于 out/
npx wrangler login                        # 本机首次部署时执行一次
npx wrangler pages project create yisi-xiangqi-pwa --production-branch main
npm run deploy:pwa
```

项目只需创建一次。以后更新直接运行 `npm run deploy:pwa`。

在 iPhone 上用 Safari 打开部署后的 `https://yisi-xiangqi-pwa.pages.dev`，点“共享”→“添加到主屏幕”→“添加”。主屏幕版本以独立窗口运行，不受免费开发者签名七天有效期限制。

皮卡鱼及本项目内的相应引擎文件遵循 GPL-3.0，来源说明见 [`public/pikafish/SOURCE.md`](public/pikafish/SOURCE.md)。
