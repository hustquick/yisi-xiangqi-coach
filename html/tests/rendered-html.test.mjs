import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the shared coach features", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /弈思/);
  assert.match(html, /分析深度/);
  assert.match(html, /全局最优着法/);
  assert.match(html, /局势图/);
  assert.match(html, /双方各走一步计 1 回合/);
  assert.doesNotMatch(html, /构思你的计划/);
  assert.doesNotMatch(html, /引导训练|先看全局，再决定/);
  assert.doesNotMatch(html, /<svg[\s\S]*?<title(?:\s|>)/i);
});

test("keeps engine cancellation, selectable depth and arrow overlay wired", async () => {
  const [page, css, worker, server, icon] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(
      new URL("../public/pikafish/engine-worker.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../tools/pikafish-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
  ]);
  assert.match(page, /DEPTH_OPTIONS = \[8, 10, 12, 14, 16\]/);
  assert.match(page, /CandidateArrows/);
  assert.match(page, /boardFlipped/);
  assert.match(page, /aria-label="切换红黑视角"/);
  assert.match(page, /className="board-lines"/);
  assert.match(page, /M1 0V4 M1 5V9/);
  assert.doesNotMatch(page, /className="palace p[12]"/);
  assert.match(page, /flipped=\{boardFlipped\}/);
  assert.match(page, /SituationChart/);
  assert.match(page, /function goToPly/);
  assert.match(page, /onSelectPly=\{goToPly\}/);
  assert.match(page, /positionAtPly/);
  assert.match(page, /buildVariationFrames/);
  assert.match(page, /scheduleCandidatePreview/);
  assert.match(page, /previewedCandidateMove/);
  assert.match(
    page,
    /scrollIntoView\(\{\s*behavior: "smooth",\s*block: "start",?\s*\}\)/,
  );
  assert.match(page, /index % 2 === 0 \? "a" : "b"/);
  assert.match(page, /单击动画演示/);
  assert.match(page, /onPointerMove=\{moveScrub\}/);
  assert.match(page, /onPreviewPly=\{previewTimeline\}/);
  assert.match(page, /principalVariationText/);
  assert.match(page, /localizedVariation/);
  assert.match(page, /equivalentEngineScore/);
  assert.match(page, /属于全局最优着法/);
  assert.match(page, /positionChange/);
  assert.match(page, /redPerspectiveScore/);
  assert.match(page, /scope: "backfill"/);
  assert.match(page, /positionScores/);
  assert.match(page, /红方视角评分/);
  assert.match(page, /engineCandidates\(engineLines, pieces, turn\)/);
  assert.match(page, /wasEngineBest/);
  assert.match(page, /落子前皮卡鱼首选是/);
  assert.doesNotMatch(page, /rest\.slice\(0, 4\)\.join\(" "\)/);
  assert.match(page, /onDoubleClick=\{\(\) => playCandidate/);
  assert.match(page, /type GameMode = "local" \| "computer" \| "setup"/);
  assert.match(page, /人机对战/);
  assert.match(page, /完成摆盘/);
  assert.match(page, /scheduleComputerMove|aiPositionRef/);
  assert.ok(
    page.indexOf('className="board-wrap"') <
      page.indexOf('className="coach-sidebar"'),
    "secondary controls should follow the board in the right sidebar",
  );
  assert.ok(
    page.indexOf("<SituationChart") < page.indexOf("分析深度"),
    "depth selector should follow the situation chart",
  );
  assert.match(css, /\.candidate-arrows/);
  assert.match(css, /\.game-mode-bar/);
  assert.match(css, /\.setup-panel/);
  assert.match(css, /\.top-coordinates\{margin-bottom:10px\}/);
  assert.match(css, /\.board\{background:#d9b071;background-image:none\}/);
  assert.match(css, /\.board:after\{display:none\}/);
  assert.match(css, /\.board-lines path\{[^}]*vector-effect:non-scaling-stroke/);
  assert.match(css, /\.bottom-coordinates\{margin-top:10px\}/);
  assert.match(css, /\.trend-hit-area/);
  assert.match(css, /\.variation-playback/);
  assert.match(css, /\.candidate\.previewing/);
  assert.match(css, /\.timeline-preview/);
  assert.match(css, /touch-action:none/);
  assert.match(worker, /type === "stop"/);
  assert.match(server, /req\.url === "\/stop"/);
  assert.match(icon, />象<\/text>/);
});

test("keeps the board left and all secondary modules in one right sidebar", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const board = page.indexOf('className="board-wrap"');
  const sidebar = page.indexOf('className="coach-sidebar"');
  assert.ok(board >= 0 && sidebar > board);
  assert.ok(page.indexOf('title="教练分析"', sidebar) >= sidebar);
  assert.ok(page.indexOf('title="局势图"', sidebar) >= sidebar);
  assert.ok(page.indexOf('title="对弈与分析设置"', sidebar) >= sidebar);
  assert.ok(
    page.indexOf('title="局势图"', sidebar) <
      page.indexOf('title="对弈与分析设置"', sidebar),
    "match and analysis settings should follow the situation chart",
  );
  assert.ok(page.indexOf('title="棋谱与存档"', sidebar) >= sidebar);
  assert.equal(page.includes('title="对弈模式"'), false);
});
