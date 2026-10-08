#!/usr/bin/env bash
# Loads and audits the `production` GitHub environment that the release
# workflows read (release-desktop.yml, release-web.yml). The names below are
# the contract; the values come from an owner-only env file that is never
# committed. See apps/documentation/src/content/docs/desktop/releasing.mdx.
#
#   bash scripts/production-env.sh check            which names are still missing
#   bash scripts/production-env.sh load [FILE]      push KEY=value lines from FILE
#                                                   (default .production.env, mode 600)
#
# Values never reach argv, logs or the terminal: secrets go to gh over stdin.
set -euo pipefail

ENVIRONMENT="production"
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo csdev19/port-watcher)}"

SECRETS=(
  RELEASE_PLEASE_TOKEN
  CSC_LINK
  CSC_KEY_PASSWORD
  APPLE_API_KEY
  APPLE_API_KEY_ID
  APPLE_API_ISSUER
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  DATABASE_URL
  BETTER_AUTH_SECRET
  BETTER_AUTH_URL
)
VARIABLES=(
  R2_BUCKET
  DOWNLOAD_BASE_URL
)

# Constants of this deployment (ADR 0004). Applied by `load` when the env file
# does not override them and the environment does not have them yet.
DEFAULT_BETTER_AUTH_URL="https://port-watcher.cs19.dev"
DEFAULT_R2_BUCKET="port-watcher-bucket"

usage() {
  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() {
  printf 'production-env: %s\n' "$*" >&2
  exit 1
}

contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

remote_secrets() {
  gh secret list --env "$ENVIRONMENT" -R "$REPO" --json name -q '.[].name'
}

remote_variables() {
  gh variable list --env "$ENVIRONMENT" -R "$REPO" --json name -q '.[].name'
}

check() {
  local present missing=0 name
  printf 'Environment %s of %s\n\nSecrets\n' "$ENVIRONMENT" "$REPO"
  present="$(remote_secrets)"
  for name in "${SECRETS[@]}"; do
    if grep -qx "$name" <<<"$present"; then
      printf '  [x] %s\n' "$name"
    else
      printf '  [ ] %s\n' "$name"
      missing=$((missing + 1))
    fi
  done
  printf '\nVariables\n'
  present="$(remote_variables)"
  for name in "${VARIABLES[@]}"; do
    if grep -qx "$name" <<<"$present"; then
      printf '  [x] %s\n' "$name"
    else
      printf '  [ ] %s\n' "$name"
      missing=$((missing + 1))
    fi
  done
  printf '\n'
  if [[ "$missing" -eq 0 ]]; then
    printf 'Complete: %d secrets and %d variables.\n' "${#SECRETS[@]}" "${#VARIABLES[@]}"
  else
    printf '%d of %d names still missing.\n' "$missing" "$((${#SECRETS[@]} + ${#VARIABLES[@]}))"
    return 1
  fi
}

set_secret() {
  printf '%s' "$2" | gh secret set "$1" --env "$ENVIRONMENT" -R "$REPO"
  printf '  secret   %s\n' "$1"
}

set_variable() {
  gh variable set "$1" --env "$ENVIRONMENT" -R "$REPO" --body "$2"
  printf '  variable %s\n' "$1"
}

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

load() {
  local file="${1:-.production.env}"
  local line name value loaded=()

  if [[ ! -f "$file" ]]; then
    die "no env file at $file. Write KEY=value lines (chmod 600); see releasing.mdx for the names."
  fi
  if [[ "$(file_mode "$file")" != "600" ]]; then
    die "$file must be readable by you only: chmod 600 $file"
  fi

  printf 'Loading %s into environment %s of %s\n' "$file" "$ENVIRONMENT" "$REPO"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    line="${line#export }"
    [[ "$line" == *=* ]] || die "cannot parse line: ${line%%=*}"
    name="${line%%=*}"
    value="${line#*=}"
    if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    if [[ -z "$value" ]]; then
      printf '  skip     %s (empty)\n' "$name"
      continue
    fi
    if contains "$name" "${SECRETS[@]}"; then
      set_secret "$name" "$value"
    elif contains "$name" "${VARIABLES[@]}"; then
      if [[ "$name" == DOWNLOAD_BASE_URL && ("$value" != https://* || "$value" == */) ]]; then
        die "DOWNLOAD_BASE_URL must start with https:// and have no trailing slash"
      fi
      set_variable "$name" "$value"
    else
      printf '  skip     %s (not a release name)\n' "$name"
      continue
    fi
    loaded+=("$name")
  done <"$file"

  local present
  present="$(remote_secrets)"
  if ! contains BETTER_AUTH_URL "${loaded[@]}" && ! grep -qx BETTER_AUTH_URL <<<"$present"; then
    printf 'Default  BETTER_AUTH_URL = %s\n' "$DEFAULT_BETTER_AUTH_URL"
    set_secret BETTER_AUTH_URL "$DEFAULT_BETTER_AUTH_URL"
  fi
  if ! contains BETTER_AUTH_SECRET "${loaded[@]}" && ! grep -qx BETTER_AUTH_SECRET <<<"$present"; then
    printf 'Generated BETTER_AUTH_SECRET (openssl rand -base64 32). It lives only in the environment; rotate it by running load with a new value.\n'
    set_secret BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
  fi
  present="$(remote_variables)"
  if ! contains R2_BUCKET "${loaded[@]}" && ! grep -qx R2_BUCKET <<<"$present"; then
    printf 'Default  R2_BUCKET = %s\n' "$DEFAULT_R2_BUCKET"
    set_variable R2_BUCKET "$DEFAULT_R2_BUCKET"
  fi

  printf '\n'
  check
}

command -v gh >/dev/null 2>&1 || die "gh is required: https://cli.github.com"

case "${1:-}" in
  check) check ;;
  load) load "${2:-}" ;;
  -h | --help | help) usage 0 ;;
  *) usage 1 ;;
esac
