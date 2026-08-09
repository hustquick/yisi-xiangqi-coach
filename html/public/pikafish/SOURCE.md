# Pikafish WebAssembly source

This application distributes a WebAssembly build of Pikafish under GNU GPL v3.

- Upstream source: https://github.com/official-pikafish/Pikafish
- Upstream revision used: `b2180562` (2026-07-26)
- Evaluation network: https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue
- Browser entry point used for this build: `web_main.cpp` in this directory
- License: `COPYING.txt` in this directory

Build target: Emscripten 6.0.5, `wasm32`, WebAssembly SIMD, one search thread.
