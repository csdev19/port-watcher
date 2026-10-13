#!/bin/sh
# Builds and checks chapay's update feed (`updates/latest.json`), the static
# file tauri-plugin-updater reads. Used by .github/workflows/release-desktop.yml
# and tested by src/updater-feed.test.ts. Needs jq. See ADR 0007.
#
#   updater-feed.sh write VERSION BASE_URL NOTES PUB_DATE SIG_ARM64 SIG_X64
#       Prints the feed. SIG_* are the `.sig` files `tauri bundle` wrote; the
#       feed holds their contents. Archive URLs point at the immutable
#       BASE_URL/download/VERSION/ copies, never at latest/.
#
#   updater-feed.sh validate FEED VERSION BASE_URL
#       Fails unless FEED announces VERSION for both Macs, with HTTPS URLs
#       under BASE_URL/download/VERSION/ and non-empty signatures.
#
#   updater-feed.sh compare LIVE_FEED VERSION
#       Prints "publish" when VERSION is newer than the live feed (or there is
#       no live feed: pass an empty file), "republish" when it is the same
#       version (a rerun of the tag re-signed the archives, so the feed must
#       follow), and fails when the live feed is newer: the feed never moves
#       backwards.
set -eu

die() {
  printf 'updater-feed: %s\n' "$*" >&2
  exit 1
}

is_plain_version() {
  printf '%s' "$1" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
}

cmd="${1:-}"
[ -n "$cmd" ] || die "usage: updater-feed.sh write|validate|compare ..."
shift

case "$cmd" in
  write)
    [ "$#" -eq 6 ] || die "write needs VERSION BASE_URL NOTES PUB_DATE SIG_ARM64 SIG_X64"
    version="$1" base="${2%/}" notes="$3" pub_date="$4" sig_arm64="$5" sig_x64="$6"
    is_plain_version "$version" || die "not an X.Y.Z version: $version"
    case "$base" in https://*) ;; *) die "BASE_URL must use https: $base" ;; esac
    for sig in "$sig_arm64" "$sig_x64"; do
      [ -s "$sig" ] || die "missing or empty signature file: $sig"
    done
    jq -n \
      --arg version "$version" \
      --arg notes "$notes" \
      --arg pub_date "$pub_date" \
      --arg arm64 "$base/download/$version/chapay-arm64.app.tar.gz" \
      --arg x64 "$base/download/$version/chapay-x64.app.tar.gz" \
      --rawfile sig_arm64 "$sig_arm64" \
      --rawfile sig_x64 "$sig_x64" \
      '{
        version: $version,
        notes: $notes,
        pub_date: $pub_date,
        platforms: {
          "darwin-aarch64": { url: $arm64, signature: ($sig_arm64 | gsub("\\s"; "")) },
          "darwin-x86_64": { url: $x64, signature: ($sig_x64 | gsub("\\s"; "")) }
        }
      }'
    ;;

  validate)
    [ "$#" -eq 3 ] || die "validate needs FEED VERSION BASE_URL"
    feed="$1" version="$2" base="${3%/}"
    jq -e \
      --arg version "$version" \
      --arg prefix "$base/download/$version/" \
      '
        def ok(p; arch):
          (p.url == ($prefix + "chapay-" + arch + ".app.tar.gz"))
          and (p.url | startswith("https://"))
          and ((p.signature | type) == "string")
          and ((p.signature | length) > 0);
        .version == $version
        and ((.pub_date | type) == "string")
        and (.platforms | keys == ["darwin-aarch64", "darwin-x86_64"])
        and ok(.platforms["darwin-aarch64"]; "arm64")
        and ok(.platforms["darwin-x86_64"]; "x64")
      ' "$feed" >/dev/null || die "$feed is not a valid feed for $version under $base"
    ;;

  compare)
    [ "$#" -eq 2 ] || die "compare needs LIVE_FEED VERSION"
    live_feed="$1" version="$2"
    is_plain_version "$version" || die "not an X.Y.Z version: $version"
    if [ ! -s "$live_feed" ]; then
      echo publish
      exit 0
    fi
    live="$(jq -r '.version // empty' "$live_feed")" || die "the live feed is not JSON"
    is_plain_version "$live" || die "the live feed has no X.Y.Z version: '$live'"
    order="$(jq -nr --arg a "$version" --arg b "$live" '
      ($a | split(".") | map(tonumber)) as $x
      | ($b | split(".") | map(tonumber)) as $y
      | if $x > $y then "newer" elif $x == $y then "same" else "older" end')"
    case "$order" in
      newer) echo publish ;;
      same) echo republish ;;
      *) die "the live feed announces $live, newer than $version; refusing to move it backwards" ;;
    esac
    ;;

  *)
    die "unknown command: $cmd"
    ;;
esac
