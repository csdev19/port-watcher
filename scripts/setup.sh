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
# Remember whether the user's own shell can see cargo BEFORE this script fixes
# its PATH for itself. Tauri runs `cargo metadata` from `bun run dev`, which
# inherits the shell's PATH, not ours: a setup that passes here but leaves the
# shell blind to cargo is misconfigured, and we say so at the end.
ORIGINAL_PATH="$PATH"
if command -v cargo >/dev/null 2>&1; then
  CARGO_ON_SHELL_PATH=1
else
  CARGO_ON_SHELL_PATH=0
fi
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

# A new interactive shell is what `bun run dev` will actually run in. If it
# cannot find cargo, the shell startup files never load the Rust environment
# (rustup only writes ~/.cargo/env; it does not edit dotfiles). Fail loudly:
# `bun run dev` would otherwise die with "cargo metadata ... No such file".
# The probe gets the PATH this script was started with, not the one it fixed
# for itself above, so only the shell's own startup files can make it pass.
# shellcheck disable=SC2016 # the $HOME lines are instructions to paste, not expansions
if [[ "$CARGO_ON_SHELL_PATH" -eq 0 ]] \
  && ! PATH="$ORIGINAL_PATH" "${SHELL:-/bin/zsh}" -ic 'command -v cargo' >/dev/null 2>&1; then
  printf '\nSetup finished, but your shell is misconfigured: it cannot find cargo.\n' >&2
  printf 'Rust is installed in %s/bin, yet no shell startup file puts it on PATH,\n' "$CARGO_HOME" >&2
  printf 'so `bun run dev` will fail at `cargo metadata`.\n\n' >&2
  printf 'Fix it once, in your dotfiles or ~/.zshrc:\n' >&2
  printf '  export PATH="$HOME/.cargo/bin:$PATH"\n' >&2
  printf 'or\n' >&2
  printf '  . "$HOME/.cargo/env"\n\n' >&2
  printf 'Then open a new terminal (or `source ~/.zshrc`) and run: bun dev\n' >&2
  exit 1
fi

printf '\nSetup complete. Run: bun dev\n'
