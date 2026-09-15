#!/usr/bin/env bash
set -euo pipefail

# Local signed (and, with the APPLE_API_* vars set, notarized) macOS build.
#
# electron-builder reads process.env but does NOT load .env* files itself, so the
# signing vars are injected here. `set -a` exports every assignment that follows,
# i.e. everything sourced from .env.signing.

cd "$(dirname "$0")/.."

if [ ! -f .env.signing ]; then
  echo "Missing .env.signing — copy .env.signing.example and fill it in." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.signing
set +a

echo "-> Signing identities available:"
security find-identity -v -p codesigning | grep "Developer ID Application" || true

# 1) build renderer + main with electron-vite (runs the type-check first)
bun run build

# 2) package + sign (+ notarize + staple when the APPLE_API_* vars are set)
bunx electron-builder --mac --publish never
