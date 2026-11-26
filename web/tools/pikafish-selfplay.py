#!/usr/bin/env python3
"""Headless Pikafish self-play for Yisi Xiangqi Coach (Python 3.9+).

Run from any directory: python3 web/tools/pikafish-selfplay.py --games 10
Builds a separate native engine with a read-only adjudication command.
No changes to the app or its existing engine binary.
"""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "iOS/ThirdParty/Pikafish/src"
ENGINE_DIR = ROOT / "web/.local/pikafish"
FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
MOVE = re.compile(r"[a-i][0-9][a-i][0-9]")

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def build_engine():
    # Use the exact same pinned source as web/tools/setup-pikafish.sh.
    # Build in a temporary directory; the normal app executable is untouched.
    if platform.system() != "Darwin":
        raise RuntimeError("Automatic build currently targets macOS.")
    network = ENGINE_DIR / "pikafish.nnue"
    if not network.is_file():
        subprocess.run(["bash", str(ROOT / "web/tools/setup-pikafish.sh")], check=True)
    target = ENGINE_DIR / "pikafish-selfplay"
    with tempfile.TemporaryDirectory(prefix="pikafish-selfplay-") as tmp:
        src = Path(tmp) / "src"
        shutil.copytree(SOURCE, src)
        header = src / "engine.h"
        code = header.read_text()
        marker = "visualize() const;"
        if code.count(marker) != 1:
            raise RuntimeError("Engine header changed; cannot install adjudication command.")
        header.write_text(code.replace(marker, marker + "\n    std::string selfplay_status();"))
        impl = src / "engine.cpp"
        code = impl.read_text()
        marker = "std::string Engine::visualize() const"
        if code.count(marker) != 1:
            raise RuntimeError("Engine implementation changed.")
        extra = """
std::string Engine::selfplay_status() {
    if (MoveList<LEGAL>(pos).size() == 0)
        return pos.checkers() ? "loss checkmate" : "loss stalemate";
    Value result = VALUE_NONE;
    if (pos.rule_judge(result, 0)) {
        if (result == VALUE_DRAW) return "draw engine_rule";
        return result > VALUE_DRAW ? "win engine_rule" : "loss engine_rule";
    }
    return "ongoing none";
}
"""
        impl.write_text(code.replace(marker, extra + "\n" + marker).replace('#include "engine.h"', '#include "engine.h"\n#include "movegen.h"', 1))
        uci = src / "uci.cpp"
        code = uci.read_text()
        marker = 'else if (token == "d")'
        if code.count(marker) != 1:
            raise RuntimeError("UCI implementation changed.")
        uci.write_text(code.replace(marker, 'else if (token == "selfplaystatus")\n            sync_cout << "selfplaystatus " << engine.selfplay_status() << sync_endl;\n        ' + marker))
        arch = "apple-silicon" if platform.machine() == "arm64" else "x86-64"
        subprocess.run(["make", "-C", str(src), "-j4", "pikafish", "ARCH=" + arch], check=True)
        shutil.copy2(src / "pikafish", target)
    return target, network

class Engine:
    def __init__(self, binary, network, args):
        self.q = queue.Queue()
        self.timeout = args.timeout
        self.p = subprocess.Popen([str(binary)], cwd=str(network.parent),
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  text=True, bufsize=1)
        threading.Thread(target=self.reader, daemon=True).start()
        try:
            self.send("uci")
            lines = self.until(lambda s: s == "uciok")
            self.identity = next((s[8:] for s in lines if s.startswith("id name ")), "unknown")
            options = {s.split(" type ")[0][12:] for s in lines if s.startswith("option name ")}
            settings = {"Threads": args.threads, "Hash": args.hash,
                        "MultiPV": 1, "Skill Level": 20,
                        "UCI_LimitStrength": "false" if args.full else "true",
                        "EvalFile": str(network)}
            if not args.full:
                settings["UCI_Elo"] = 3100
            for k, v in settings.items():
                if k not in options:
                    raise RuntimeError("Missing engine option: " + k)
                self.send(f"setoption name {k} value {v}")
            self.ready()
        except BaseException:
            self.close()
            raise

    def reader(self):
        try:
            for line in self.p.stdout:
                self.q.put(line.strip())
        finally:
            self.q.put(None)

    def send(self, command):
        self.p.stdin.write(command + "\n")
        self.p.stdin.flush()

    def until(self, predicate):
        end = time.monotonic() + self.timeout
        lines = []
        while True:
            try:
                s = self.q.get(timeout=max(0, end - time.monotonic()))
            except queue.Empty:
                raise TimeoutError("Pikafish response timeout")
            if s is None:
                raise RuntimeError("Pikafish exited unexpectedly")
            lines.append(s)
            if predicate(s):
                return lines

    def ready(self):
        self.send("isready")
        self.until(lambda s: s == "readyok")

    def position(self, moves):
        self.send("position fen " + FEN + (" moves " + " ".join(moves) if moves else ""))
        self.ready()

    def status(self):
        self.send("selfplaystatus")
        return self.until(lambda s: s.startswith("selfplaystatus "))[-1].split()[1:]

    def fen(self):
        self.send("d")
        self.send("isready")
        lines = self.until(lambda s: s == "readyok")
        return next(s[5:] for s in lines if s.startswith("Fen: "))

    def search(self, args, red):
        start = time.monotonic()
        self.send(f"go {args.search_type} {args.search_value}")
        lines = self.until(lambda s: s.startswith("bestmove "))
        move = lines[-1].split()[1]
        if not MOVE.fullmatch(move):
            raise RuntimeError("Unexpected bestmove in ongoing position: " + move)
        info = next((s for s in reversed(lines) if s.startswith("info depth ") and " score " in s and " pv " in s), "")
        score = re.search(r"\bscore (cp|mate) (-?\d+)", info)
        row = {"move": move, "side": "red" if red else "black",
               "seconds": round(time.monotonic() - start, 4),
               "score_type": score[1] if score else None,
               "red_score": int(score[2]) * (1 if red else -1) if score else None,
               "score_bound": ("lower" if " lowerbound" in info else "upper" if " upperbound" in info else None),
               "raw_info": info}
        for key in ("depth", "nodes", "time"):
            match = re.search(r"\b" + key + r" (\d+)", info)
            row[key] = int(match[1]) if match else None
        return row

    def close(self):
        if self.p.poll() is None:
            try:
                self.send("quit")
                self.p.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                self.p.kill()
                self.p.wait()
        self.p.stdin.close()
        self.p.stdout.close()

def play(engines, args, number):
    start = time.monotonic()
    moves, details = [], []
    for e in engines:
        e.send("ucinewgame")
        e.ready()
    for ply in range(args.max_plies + 1):
        e = engines[ply % 2]
        red = ply % 2 == 0
        e.position(moves)
        status, reason = e.status()
        if status != "ongoing":
            if status == "draw":
                result = "draw"
            elif status in ("win", "loss"):
                result = "red" if (red == (status == "win")) else "black"
            else:
                raise RuntimeError("Unknown adjudication: " + status)
            break
        if ply == args.max_plies:
            result, reason = "truncated", "max_plies"
            break
        row = e.search(args, red)
        moves.append(row["move"])
        details.append(row)
        if args.verbose:
            print(f"Game {number} ply {ply+1}: {row['move']} ({row['seconds']:.2f}s)", flush=True)
    return {"game": number, "result": result, "reason": reason, "plies": len(moves),
            "seconds": round(time.monotonic() - start, 3), "initial_fen": FEN,
            "final_fen": e.fen(), "moves": moves, "details": details}

def atomic_json(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)

def summarize(out, games):
    counts = {k: sum(g["result"] == k for g in games) for k in ("red", "black", "draw", "truncated")}
    n = counts["red"] + counts["black"] + counts["draw"]
    summary = {"completed": len(games), **counts, "decided_or_drawn": n,
               "red_win_rate": counts["red"]/n if n else None,
               "black_win_rate": counts["black"]/n if n else None,
               "draw_rate": counts["draw"]/n if n else None,
               "red_score_rate": (counts["red"] + counts["draw"]/2)/n if n else None,
               "black_score_rate": (counts["black"] + counts["draw"]/2)/n if n else None,
               "unique_move_sequences": len({tuple(g["moves"]) for g in games})}
    atomic_json(out / "summary.json", summary)
    tmp = out / "games.csv.tmp"
    keys = ["game", "result", "reason", "plies", "seconds", "initial_fen", "final_fen", "moves"]
    with tmp.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        for g in games:
            writer.writerow({**{k:g[k] for k in keys if k != "moves"}, "moves":" ".join(g["moves"])})
    tmp.replace(out / "games.csv")
    print(json.dumps(summary, ensure_ascii=False), flush=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--games", type=int, default=10)
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--hash", type=int, default=256)
    p.add_argument("--max-plies", type=int, default=600)
    p.add_argument("--timeout", type=int, default=600)
    p.add_argument("--full", action="store_true", help="Disable Elo limit; default is project top tier 3100")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--rebuild", action="store_true")
    p.add_argument("--out", type=Path, default=ROOT / "web/.local/selfplay-results")
    group = p.add_mutually_exclusive_group()
    group.add_argument("--depth", type=int)
    group.add_argument("--movetime", type=int, help="Milliseconds per move")
    group.add_argument("--nodes", type=int)
    args = p.parse_args()
    args.search_type, args.search_value = next(((k, getattr(args,k)) for k in ("depth","movetime","nodes") if getattr(args,k) is not None), ("depth",16))
    if min(args.games,args.threads,args.hash,args.max_plies,args.timeout,args.search_value) < 1:
        p.error("Numeric parameters must be positive")
    binary, network = ENGINE_DIR / "pikafish-selfplay", ENGINE_DIR / "pikafish.nnue"
    if args.rebuild or not binary.is_file() or not network.is_file():
        binary, network = build_engine()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    config = {"engine_sha256": digest(binary), "network_sha256": digest(network),
              "elo": None if args.full else 3100, "threads": args.threads, "hash": args.hash,
              "search_type": args.search_type, "search_value": args.search_value,
              "max_plies": args.max_plies, "initial_fen": FEN}
    config_path = out / "config.json"
    if config_path.exists() and json.loads(config_path.read_text()) != config:
        raise RuntimeError("Configuration differs; select a new --out directory.")
    atomic_json(config_path, config)
    # One atomic file per finished game makes interruption recovery straightforward.
    games = [json.loads(f.read_text()) for f in sorted(out.glob("game-*.json"))]
    games.sort(key=lambda g:g["game"])
    if [g["game"] for g in games] != list(range(1,len(games)+1)):
        raise RuntimeError("Non-contiguous game history")
    if len(games) > args.games:
        raise RuntimeError("--games is less than the number already completed")
    summarize(out, games)
    engines = []
    try:
        if len(games) < args.games:
            for _ in range(2):
                engines.append(Engine(binary, network, args))
            print("Engine:", engines[0].identity, flush=True)
        for number in range(len(games)+1, args.games+1):
            game = play(engines, args, number)
            atomic_json(out / f"game-{number:06d}.json", game)
            games.append(game)
            print(f"{number}/{args.games}: {game['result']} ({game['reason']})", flush=True)
            summarize(out, games)
    finally:
        for e in engines:
            e.close()

if __name__ == "__main__":
    main()
