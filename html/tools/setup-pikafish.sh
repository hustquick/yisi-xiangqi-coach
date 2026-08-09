#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_DIR="$ROOT_DIR/.local/pikafish"
SOURCE_DIR="$(mktemp -d /tmp/pikafish-build.XXXXXX)"
git clone --depth 1 https://github.com/official-pikafish/Pikafish.git "$SOURCE_DIR"
if [ "$(uname -m)" = "arm64" ]; then ENGINE_ARCH="apple-silicon"; else ENGINE_ARCH="x86-64"; fi
make -C "$SOURCE_DIR/src" -j4 build ARCH="$ENGINE_ARCH"
mkdir -p "$ENGINE_DIR"
cp "$SOURCE_DIR/src/pikafish" "$ENGINE_DIR/pikafish"
curl -L --fail --silent --show-error -o "$ENGINE_DIR/pikafish.nnue" https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue
cp "$SOURCE_DIR/Copying.txt" "$ENGINE_DIR/COPYING.txt"
echo "Pikafish installed in $ENGINE_DIR"
