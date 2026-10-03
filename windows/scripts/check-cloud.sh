#!/usr/bin/env bash
# Checks Awuuu on a Linux machine (Claude on the cloud) without GitHub Actions:
#   1. TypeScript: tsc --noEmit (and vitest once it is set up)
#   2. Rust: cargo check for Windows (x86_64-pc-windows-gnu, cross-compiled with mingw)
#   3. Rust tests: built for Windows and run under wine
#
# Usage, from windows/:  bash scripts/check-cloud.sh
# The real build and the installer still happen on Windows: `npm run pack`.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=x86_64-pc-windows-gnu
step() { printf '\n== %s\n' "$*"; }

step "Tools"
if ! command -v x86_64-w64-mingw32-gcc >/dev/null || ! [ -x /usr/lib/wine/wine64 ]; then
  apt-get update -qq >/dev/null
  apt-get install -y -qq --no-install-recommends gcc-mingw-w64-x86-64 wine64 >/dev/null
fi
rustup target add "$TARGET" >/dev/null 2>&1

step "TypeScript"
[ -d node_modules ] || npm ci --silent
npx tsc --noEmit
if grep -q '"test"' package.json; then npm test --silent; fi

# tauri-build wants the hook exe (bundled as a resource) and the frontend dist
# to exist; empty stand-ins are enough to type-check and test.
mkdir -p target/release dist
[ -f target/release/awuuu-hook.exe ] || touch target/release/awuuu-hook.exe

step "Rust check (Windows target)"
cargo check -q --workspace --all-targets --target "$TARGET"

step "Rust tests (under wine)"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=/usr/lib/wine/wine64
export WINEDEBUG=-all WINEPREFIX="${WINEPREFIX:-$HOME/.wine-awuuu}"
# The app's tests need WebView2Loader.dll beside the test exe. Build first,
# copy the dll, then run.
cargo test -q -p awuuu --lib --target "$TARGET" --no-run
dll=$(find "target/$TARGET/debug/build" -path '*webview2-com-sys*/out/x64/WebView2Loader.dll' | head -1)
cp "$dll" "target/$TARGET/debug/deps/"
cargo test -q -p awuuu --lib --target "$TARGET"
# `waitfor` is a Windows command wine doesn't have, so that one test only
# runs on real Windows.
cargo test -q -p awuuu-hook --target "$TARGET" -- \
  --skip a_previous_status_line_that_hangs_is_given_up_on

step "All checks passed"
