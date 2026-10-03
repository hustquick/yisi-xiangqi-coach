/* Pikafish browser worker. GPL-3.0; source: /pikafish/SOURCE.md */
importScripts("/pikafish/pikafish.js");

// Emscripten's pthread helper starts this same worker URL with the
// "em-pthread" name.  It must run only the generated runtime bootstrap;
// installing the app-level message handler below would replace Emscripten's
// pthread mailbox and leave module initialization stuck before the NNUE
// download begins (most visible in desktop Chromium browsers).
if (self.name === "em-pthread") {
  void PikafishModule();
} else {
let analyze;
let ready;
let localEngine = false;
let activeController = null;
let analysisSequence = 0;
const NETWORK_BYTES = 51585654;

async function boot() {
  // The packaged PWA must always use its own WASM engine. Probing loopback on
  // an online page can accidentally attach to an old local-dev process, which
  // suppresses the download indicator and can leave analysis waiting forever.
  const localDevelopment = ["localhost", "127.0.0.1", "::1"].includes(self.location.hostname);
  if (localDevelopment) {
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
  }
  // Report immediately, before the WebAssembly runtime itself is fetched and
  // compiled, so desktop users never stare at an unexplained “计算中”.
  postMessage({ type: "download-progress", loaded: 0, total: NETWORK_BYTES, complete: false });
  const engineModule = await PikafishModule({
    locateFile(path) { return `/pikafish/${path.replace("pikafish-web", "pikafish")}`; },
    print() {},
    printErr(message) { console.warn("Pikafish:", message); },
  });
  const networkFile = engineModule.FS.open("/pikafish.nnue", "w");
  let downloadedBytes = 0;
  let lastReportedPercent = -1;
  const reportDownload = (complete = false) => {
    const percent = Math.floor((downloadedBytes / NETWORK_BYTES) * 100);
    if (!complete && percent === lastReportedPercent) return;
    lastReportedPercent = percent;
    postMessage({
      type: "download-progress",
      loaded: downloadedBytes,
      total: NETWORK_BYTES,
      complete,
    });
  };
  reportDownload();
  try {
    for (const part of ["00", "01", "02", "03", "04", "05", "06"]) {
      const networkResponse = await fetch(`/pikafish/network/part-${part}.bin`);
      if (!networkResponse.ok) throw new Error(`NNUE network download failed: ${networkResponse.status}`);
      if (networkResponse.body) {
        const reader = networkResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          engineModule.FS.write(networkFile, value, 0, value.length);
          downloadedBytes += value.length;
          reportDownload();
        }
      } else {
        const bytes = new Uint8Array(await networkResponse.arrayBuffer());
        engineModule.FS.write(networkFile, bytes, 0, bytes.length);
        downloadedBytes += bytes.length;
        reportDownload();
      }
    }
  } finally {
    engineModule.FS.close(networkFile);
  }
  engineModule.cwrap("pikafish_init", "string", [])();
  analyze = engineModule.cwrap("pikafish_analyze", "string", ["string", "number", "number", "number"]);
  downloadedBytes = NETWORK_BYTES;
  reportDownload(true);
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
    // The WASM wrapper implements UCI_LimitStrength/UCI_Elo itself. Keeping
    // this path enabled is essential for the installed iPhone PWA.
    const requestedMoves = Array.isArray(event.data.searchMoves)
      ? event.data.searchMoves
      : [];
    const raw = analyze(
      event.data.fen,
      event.data.depth ?? 8,
      requestedMoves.length
        ? Math.min(5, Math.max(event.data.multiPV ?? 1, requestedMoves.length))
        : event.data.multiPV ?? 3,
      event.data.elo ?? 0,
    );
    if (sequence !== analysisSequence) return;
    let lines = JSON.parse(raw);
    // The compact wrapper cannot pass `searchmoves` into Pikafish. Filter the
    // returned MultiPV set instead of failing the whole browser engine.
    if (requestedMoves.length) {
      const allowed = new Set(requestedMoves);
      lines = lines.filter(line => allowed.has(String(line.pv || "").split(/\s+/)[0]));
    }
    postMessage({ type: "analysis", id: event.data.id, scope: event.data.scope, lines });
  } catch (error) {
    if (sequence !== analysisSequence || error?.name === "AbortError") return;
    postMessage({ type: "error", id: event.data.id, scope: event.data.scope, message: String(error) });
  }
};
}
