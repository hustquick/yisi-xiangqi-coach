#!/usr/bin/env bash
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_SRC="$IOS_DIR/ThirdParty/Pikafish/src"
OUTPUT_DIR="${TMPDIR:-/tmp}/yisi-pikafish-smoke"
OUTPUT="$OUTPUT_DIR/bridge-smoke"
NETWORK="$IOS_DIR/App/Resources/pikafish.nnue"

mkdir -p "$OUTPUT_DIR"

sources=("$IOS_DIR/Bridge/PikafishBridge.mm" "$IOS_DIR/Tests/BridgeSmoke.mm")
while IFS= read -r -d '' source; do
  [[ "$source" == */main.cpp ]] && continue
  [[ "$source" == */universal/* ]] && continue
  sources+=("$source")
done < <(find "$ENGINE_SRC" -name '*.cpp' -print0)

xcrun clang++ \
  -arch arm64 \
  -std=gnu++20 \
  -O2 \
  -DNDEBUG \
  -DIS_64BIT \
  -DUSE_POPCNT \
  -DUSE_NEON=8 \
  -Wno-deprecated-enum-enum-conversion \
  -I "$ENGINE_SRC" \
  -I "$IOS_DIR/Bridge" \
  "${sources[@]}" \
  -o "$OUTPUT"

"$OUTPUT" "$NETWORK"
