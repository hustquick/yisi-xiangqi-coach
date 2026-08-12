import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binary = join(root, ".local", "pikafish", "pikafish");
const network = join(root, ".local", "pikafish", "pikafish.nnue");
if (!existsSync(binary) || !existsSync(network)) {
  console.error("Pikafish is not installed. Run: npm run engine:setup");
  process.exit(1);
}
const children = [
  spawn(process.execPath, [join(root, "tools", "pikafish-server.mjs")], { cwd: root, stdio: "inherit" }),
  spawn("npm", ["run", "dev"], { cwd: root, stdio: "inherit" }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode == null) child.kill("SIGTERM");
}
process.on("SIGINT", stop); process.on("SIGTERM", stop);
const exits = children.map(child => new Promise(resolve => child.on("exit", (code, signal) => resolve({ child, code, signal }))));
const firstExit = await Promise.race(exits);
if (!stopping && firstExit.code !== 0) {
  console.error(`Local service exited unexpectedly (${firstExit.code ?? firstExit.signal}).`);
  process.exitCode = firstExit.code ?? 1;
}
stop();
await Promise.all(exits);
