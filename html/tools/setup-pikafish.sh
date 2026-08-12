#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_DIR="$ROOT_DIR/.local/pikafish"
SOURCE_DIR="$(mktemp -d /tmp/pikafish-build.XXXXXX)"
trap 'rm -rf "$SOURCE_DIR"' EXIT
# Build the corresponding, repository-pinned source. This copy includes the
# UCI strength-limit extension used consistently by iOS and Android.
cp -R "$ROOT_DIR/../iOS/ThirdParty/Pikafish/src/." "$SOURCE_DIR/"
if [ "$(uname -m)" = "arm64" ]; then ENGINE_ARCH="apple-silicon"; else ENGINE_ARCH="x86-64"; fi
make -C "$SOURCE_DIR" -j4 pikafish ARCH="$ENGINE_ARCH"
mkdir -p "$ENGINE_DIR"
cp "$SOURCE_DIR/pikafish" "$ENGINE_DIR/pikafish"
curl -L --fail --silent --show-error -o "$ENGINE_DIR/pikafish.nnue" https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue
cp "$ROOT_DIR/../iOS/ThirdParty/Pikafish/COPYING.txt" "$ENGINE_DIR/COPYING.txt"
echo "Pikafish installed in $ENGINE_DIR"
