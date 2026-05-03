#!/bin/bash
# Build the AKD WASM bridge with operator-path stripping.
#
# Why this exists: a bare `wasm-pack build` embeds the builder's $HOME
# path into the WASM blob via debug info, panic location strings, and
# DWARF symbols. The blob ships in a public package via
# packages/directory/wasm/, so the builder's identity leaks publicly.
# This wrapper sets --remap-path-prefix flags from $HOME at runtime,
# so the script itself never references any specific build environment
# path.
#
# Cargo's stable `trim-paths = "all"` profile setting would replace this
# wrapper but is still nightly-only as of Cargo 1.90. When stable in
# Cargo proper, remove this script and use the profile setting.
#
# Usage:
#   ./build-wasm.sh                     # release build via wasm-pack
#   ./build-wasm.sh --check-only        # verify last build is clean
#                                         (no rebuild)
#
# After running, copy the artifacts into the SDK:
#   cp pkg/atrib_directory_bridge_bg.wasm \
#      pkg/atrib_directory_bridge.js \
#      pkg/atrib_directory_bridge.d.ts \
#      ../directory/wasm/

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

verify_clean() {
  local wasm="pkg/atrib_directory_bridge_bg.wasm"
  if [[ ! -f "$wasm" ]]; then
    echo "[build-wasm] no built artifact at $wasm" >&2
    return 2
  fi
  local hits
  hits=$(strings "$wasm" | grep -cE '/Users/|/home/' || true)
  if [[ "$hits" -gt 0 ]]; then
    echo "[build-wasm] FAIL: $hits operator-path strings in $wasm" >&2
    strings "$wasm" | grep -E '/Users/|/home/' | head -5 >&2
    return 1
  fi
  echo "[build-wasm] verified clean: $wasm"
  return 0
}

if [[ "${1:-}" == "--check-only" ]]; then
  verify_clean
  exit $?
fi

# --remap-path-prefix takes literal-source=replacement. Reading from
# $HOME at runtime keeps this script free of operator-specific strings.
# CARGO_HOME defaults to $HOME/.cargo if unset.
CARGO_REG="${CARGO_HOME:-$HOME/.cargo}/registry/src"

export RUSTFLAGS="--remap-path-prefix=$HOME=~ --remap-path-prefix=$CARGO_REG=/cargo-registry"

echo "[build-wasm] building with path remapping enabled"
wasm-pack build --target nodejs --release

verify_clean
