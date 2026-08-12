import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const enginePath = join(root, ".local", "pikafish", "pikafish");
const logicalCores = availableParallelism();
const requestedThreads = Number(process.env.PIKAFISH_THREADS);
// Use multiple cores by default while reserving capacity for the browser.
const threadCount = Number.isFinite(requestedThreads)
  ? Math.max(1, Math.min(logicalCores, Math.trunc(requestedThreads)))
  : Math.max(1, Math.min(4, logicalCores > 2 ? logicalCores - 1 : logicalCores));
const port = Number(process.env.PIKAFISH_PORT ?? 8789);
const engine = spawn(enginePath, [], { cwd: join(root, ".local", "pikafish"), stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: engine.stdout });
let pending = null;
let queue = Promise.resolve();
let requestedGeneration = 0;

lines.on("line", line => {
  if (!pending) return;
  if (line.startsWith("info depth ") && line.includes(" multipv ") && line.includes(" pv ")) pending.info(line);
  if (line.startsWith("bestmove ")) { const done = pending.done; pending = null; done(line.split(/\s+/)[1]); }
});

function command(text) { engine.stdin.write(`${text}\n`); }
command("uci");
command(`setoption name Threads value ${threadCount}`);
command("setoption name Hash value 256");
command("isready");

function parseInfo(line) {
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
  const score = line.match(/\bscore ((?:cp|mate) -?\d+)/)?.[1] ?? "cp 0";
  const pv = line.match(/\bpv (.+)$/)?.[1] ?? "";
  return { depth, multipv, score, pv };
}

function analyze({ fen, depth = 12, multiPV = 5, searchMoves = [], elo = 0 }) {
  return new Promise(resolve => {
    const latest = new Map();
    pending = {
      info(line) { const parsed = parseInfo(line); latest.set(parsed.multipv, parsed); },
      done(bestmove) {
        const result = [...latest.values()].sort((a, b) => a.multipv - b.multipv);
        if (elo && result[0] && bestmove) {
          const continuation = result[0].pv.split(/\s+/).slice(1).join(" ");
          result[0].pv = `${bestmove}${continuation ? ` ${continuation}` : ""}`;
        }
        resolve(result);
      },
    };
    const limitedElo = Math.max(1320, Math.min(3190, Number(elo) || 0));
    command(`setoption name UCI_LimitStrength value ${elo ? "true" : "false"}`);
    if (elo) command(`setoption name UCI_Elo value ${limitedElo}`);
    command(`setoption name MultiPV value ${Math.max(1, Math.min(64, multiPV))}`);
    command(`position fen ${fen}`);
    const restricted = Array.isArray(searchMoves) && searchMoves.length ? ` searchmoves ${searchMoves.join(" ")}` : "";
    command(`go depth ${Math.max(1, Math.min(24, depth))}${restricted}`);
  });
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  if (req.url === "/health") { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify({ engine: "Pikafish", mode: "native", threads: threadCount, network: "local" })); return; }
  if (req.url === "/stop" && req.method === "POST") {
    requestedGeneration++;
    command("stop");
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.url !== "/analyze" || req.method !== "POST") { res.writeHead(404, cors); res.end(); return; }
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    const generation = ++requestedGeneration;
    // Interrupt the running request immediately. Queued requests check the
    // generation below, so only the newest position is allowed to start.
    command("stop");
    queue = queue.then(async () => {
      if (generation !== requestedGeneration || res.destroyed) return;
      try { const result = await analyze(JSON.parse(body)); if (!res.destroyed) { res.writeHead(200, { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(result)); } }
      catch (error) { if (!res.destroyed) { res.writeHead(500, cors); res.end(JSON.stringify({ error: String(error) })); } }
    });
  });
}).listen(port, "127.0.0.1", () => console.log(`Local Pikafish ready at http://127.0.0.1:${port} (${threadCount} threads, local NNUE)`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { command("quit"); engine.kill(); process.exit(0); });
