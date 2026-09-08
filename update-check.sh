#!/usr/bin/env bash
# Public revision metadata only. Never fetch Git objects or execute remote data.
set -uo pipefail
unknown='{"status":"unknown","installed_revision":null,"latest_revision":null,"command":"gg self-update"}'
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$unknown"
  exit 0
fi
installed=$(git -C "${1:-$(dirname "$0")}" rev-parse HEAD 2>/dev/null || true)
if [[ ! "$installed" =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' "$unknown"
  exit 0
fi
result=$(jq -cn --arg installed "$installed" \
  '{status:"unknown",installed_revision:$installed,latest_revision:null,command:"gg self-update"}')
if [[ "${GG_NO_UPDATE_CHECK:-}" == 1 ]]; then
  printf '%s\n' "$result"
  exit 0
fi

cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/gg"
cache="$cache_dir/update.json"
now=$(date +%s)
cached=$(jq -ce --arg installed "$installed" --argjson now "$now" '
  select(.installed_revision == $installed and
    (.checked_at | type) == "number" and .checked_at <= $now and $now - .checked_at < 86400 and
    (.status == "available" or .status == "current" or .status == "unknown") and
    (.latest_revision == null or (.latest_revision | type == "string" and test("^[0-9a-f]{40}$")))) |
  {status, installed_revision, latest_revision, command:"gg self-update"}
' "$cache" 2>/dev/null) || cached=""
if [[ -n "$cached" ]]; then
  printf '%s\n' "$cached"
  exit 0
fi

latest=$(curl --fail --silent --show-error --location --connect-timeout 2 --max-time 2 \
  --header 'Accept: application/vnd.github+json' --user-agent gg \
  https://api.github.com/repos/noamsiegel/gg/commits/main 2>/dev/null |
  jq -er '.sha | select(type == "string" and test("^[0-9a-f]{40}$"))' 2>/dev/null) || latest=""
if [[ "$latest" =~ ^[0-9a-f]{40}$ ]]; then
  status=available
  if [[ "$latest" == "$installed" ]] || git -C "${1:-$(dirname "$0")}" merge-base --is-ancestor "$latest" "$installed" 2>/dev/null; then
    status=current
  fi
  result=$(jq -cn --arg status "$status" --arg installed "$installed" --arg latest "$latest" \
    '{status:$status,installed_revision:$installed,latest_revision:$latest,command:"gg self-update"}')
fi

# Cache failures too, so offline reviews do not repeatedly wait for a timeout.
if mkdir -p "$cache_dir" 2>/dev/null; then
  temporary=$(mktemp "$cache_dir/update.XXXXXX" 2>/dev/null) || temporary=""
  if [[ -n "$temporary" ]]; then
    trap 'rm -f "$temporary"' EXIT
    if printf '%s\n' "$result" | jq --argjson now "$now" '. + {checked_at:$now}' >"$temporary"; then
      mv "$temporary" "$cache" 2>/dev/null || true
    fi
  fi
fi
printf '%s\n' "$result"
