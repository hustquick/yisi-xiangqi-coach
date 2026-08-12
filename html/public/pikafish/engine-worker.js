/* Pikafish browser worker. GPL-3.0; source: /pikafish/SOURCE.md */
importScripts("/pikafish/pikafish.js");

let analyze;
let ready;
let localEngine = false;
let activeController = null;
let analysisSequence = 0;

async function boot() {
  try {
    const health = await fetch("http://127.0.0.1:8789/health", { signal: AbortSignal.timeout(800) });
    if (health.ok) {
      const localInfo = await health.json();
      if (localInfo.engine !== "Pikafish") throw new Error("本地端口不是 Pikafish");
      localEngine = true;
      postMessage({ type: "ready", mode: "native", threads: localInfo.threads, network: localInfo.network });
      return;
    }
  } catch {}
  const engineModule = await PikafishModule({
    locateFile(path) { return `/pikafish/${path.replace("pikafish-web", "pikafish")}`; },
    print() {},
    printErr(message) { console.warn("Pikafish:", message); },
  });
  const networkResponse = await fetch("/api/pikafish-network");
  if (!networkResponse.ok) throw new Error(`NNUE network download failed: ${networkResponse.status}`);
  engineModule.FS.writeFile("/pikafish.nnue", new Uint8Array(await networkResponse.arrayBuffer()));
  engineModule.cwrap("pikafish_init", "string", [])();
  analyze = engineModule.cwrap("pikafish_analyze", "string", ["string", "number", "number", "number"]);
  postMessage({ type: "ready", mode: "wasm" });
}

ready = boot().catch(error => postMessage({ type: "error", message: String(error) }));

self.onmessage = async event => {
  if (event.data?.type === "stop") {
    analysisSequence++;
    activeController?.abort();
    activeController = null;
    if (localEngine) fetch("http://127.0.0.1:8789/stop", { method: "POST" }).catch(() => {});
    return;
  }
  if (event.data?.type !== "analyze") return;
  const sequence = ++analysisSequence;
  await ready;
  try {
    if (localEngine) {
      activeController?.abort();
      await fetch("http://127.0.0.1:8789/stop", { method: "POST" }).catch(() => {});
      if (sequence !== analysisSequence) return;
      const controller = new AbortController();
      activeController = controller;
      const response = await fetch("http://127.0.0.1:8789/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: event.data.fen, depth: event.data.depth ?? 12, multiPV: event.data.multiPV ?? 5, searchMoves: event.data.searchMoves ?? [], elo: event.data.elo ?? 0 }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Local Pikafish failed: ${response.status}`);
      const lines = await response.json();
      if (sequence !== analysisSequence) return;
      activeController = null;
      postMessage({ type: "analysis", id: event.data.id, scope: event.data.scope, lines, mode: "native" });
      return;
    }
    if (event.data.searchMoves?.length) throw new Error("浏览器皮卡鱼暂不支持限定着法搜索，请使用本地原生模式");
    if (event.data.elo) throw new Error("参考 Elo 人机对战需要运行 npm run local 启动本地皮卡鱼");
    const raw = analyze(event.data.fen, event.data.depth ?? 12, event.data.multiPV ?? 5, 0);
    if (sequence !== analysisSequence) return;
    postMessage({ type: "analysis", id: event.data.id, scope: event.data.scope, lines: JSON.parse(raw) });
  } catch (error) {
    if (sequence !== analysisSequence || error?.name === "AbortError") return;
    postMessage({ type: "error", id: event.data.id, scope: event.data.scope, message: String(error) });
  }
};
