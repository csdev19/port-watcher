#!/usr/bin/env bash
set -euo pipefail

trap 'printf "\nSetup failed at line %s. Fix the error above and rerun bun run setup.\n" "$LINENO" >&2' ERR

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This setup script currently supports macOS only.\n' >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  printf 'Install Bun first: https://bun.sh/docs/installation\n' >&2
  exit 1
fi

printf '\nChecking Apple developer tools...\n'
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  printf 'Complete the Apple Command Line Tools installer, then rerun bun run setup.\n'
  exit 1
fi

if ! xcrun --find clang >/dev/null 2>&1 || ! xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1; then
  printf 'Apple developer tools are incomplete. Finish Xcode setup or install Command Line Tools, then rerun bun run setup.\n' >&2
  exit 1
fi

printf '\nChecking Rust...\n'
CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export CARGO_HOME
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1 && ! command -v cargo >/dev/null 2>&1; then
  printf 'Installing Rust using the official rustup installer...\n'
  installer="$(mktemp -t chapay-rustup)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    https://sh.rustup.rs --output "$installer"
  sh "$installer" -y --profile minimal --default-toolchain stable
fi

if command -v rustup >/dev/null 2>&1 && ! rustup show active-toolchain >/dev/null 2>&1; then
  rustup toolchain install stable --profile minimal
  rustup default stable
fi

cargo --version
rustc --version
cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1 >/dev/null

printf '\nInstalling workspace dependencies...\n'
bun install --frozen-lockfile

printf '\nBuilding shared packages...\n'
bun run build --filter='@port-watcher/*'

printf '\nSetup complete.\n'
if [[ -f "$CARGO_HOME/env" ]]; then
  printf 'Before running bun dev in your current terminal, load the Rust environment:\n'
  printf '  source "%s/env"\n' "$CARGO_HOME"
fi
printf 'Then run: bun dev\n'
