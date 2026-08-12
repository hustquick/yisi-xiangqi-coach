declare global {
  interface Window {
    PikafishModule: (...args: any[]) => Promise<any>;
    PIKAFISH_WASM_BASE64: string;
    PIKAFISH_NNUE_BASE64: string;
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  const block = 1024 * 1024;
  for (let offset = 0; offset < binary.length; offset += block) {
    const end = Math.min(offset + block, binary.length);
    for (let index = offset; index < end; index++)
      bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function createPikafishWorker(): Worker {
  if (
    typeof window.PikafishModule !== "function" ||
    !window.PIKAFISH_WASM_BASE64 ||
    !window.PIKAFISH_NNUE_BASE64
  )
    throw new Error("离线皮卡鱼文件不完整");

  const factorySource = window.PikafishModule.toString();
  const workerSource = `
    const PikafishModule = ${factorySource};
    let analyze = null;
    let sequence = 0;

    self.onmessage = async (event) => {
      const data = event.data || {};
      if (data.type === "init") {
        try {
          const wasmBytes = new Uint8Array(data.wasm);
          const module = await PikafishModule({
            instantiateWasm(imports, receiveInstance) {
              WebAssembly.instantiate(wasmBytes, imports)
                .then(({ instance }) => receiveInstance(instance))
                .catch((error) => self.postMessage({
                  type: "error",
                  message: "WebAssembly 初始化失败：" + String(error)
                }));
              return {};
            },
            print() {},
            printErr(message) { console.warn("Pikafish:", message); }
          });
          module.FS.writeFile("/pikafish.nnue", new Uint8Array(data.nnue));
          module.cwrap("pikafish_init", "string", [])();
          analyze = module.cwrap(
            "pikafish_analyze",
            "string",
            ["string", "number", "number", "string", "number"]
          );
          self.postMessage({
            type: "ready",
            mode: "wasm",
            threads: 1,
            network: "embedded"
          });
        } catch (error) {
          self.postMessage({ type: "error", message: String(error) });
        }
        return;
      }
      if (data.type === "stop") {
        sequence++;
        return;
      }
      if (data.type !== "analyze") return;
      const current = ++sequence;
      try {
        if (!analyze) throw new Error("皮卡鱼尚未初始化");
        // Yield once before entering synchronous WebAssembly. This lets every
        // already-queued stop/new-position message run first, so rapid moves are
        // coalesced and only the newest position is allowed to consume CPU.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (current !== sequence) return;
        const raw = analyze(
          data.fen,
          data.depth ?? 12,
          data.multiPV ?? 5,
          (data.searchMoves ?? []).join(" "),
          data.elo ?? 0
        );
        if (current !== sequence) return;
        const lines = JSON.parse(raw);
        const engineError = lines.find((line) => line && line.error)?.error;
        if (engineError) throw new Error(engineError);
        self.postMessage({
          type: "analysis",
          id: data.id,
          scope: data.scope,
          lines,
          mode: "wasm"
        });
      } catch (error) {
        if (current !== sequence) return;
        self.postMessage({
          type: "error",
          id: data.id,
          scope: data.scope,
          message: String(error)
        });
      }
    };
  `;

  const url = URL.createObjectURL(
    new Blob([workerSource], { type: "text/javascript" }),
  );
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  const wasm = decodeBase64(window.PIKAFISH_WASM_BASE64);
  const nnue = decodeBase64(window.PIKAFISH_NNUE_BASE64);
  worker.postMessage(
    { type: "init", wasm: wasm.buffer, nnue: nnue.buffer },
    [wasm.buffer, nnue.buffer],
  );
  return worker;
}
