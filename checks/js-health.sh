#!/usr/bin/env bash
# gg-globs: *.ts *.tsx *.js *.jsx *.mjs *.cjs
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is not available"
  exit 2
fi

FALLOW_VERSION="${FALLOW_VERSION:-2.79.0}"

# Compact output is normally already path:line: message. Older compact
# renderers put a space before :line; normalize only that separator and leave
# the tool's diagnostic text intact.
# Fallow writes progress and environment warnings ("node_modules not found") to
# stderr. Merging them into stdout renders them as findings, so stderr is kept
# separate and only surfaced when fallow actually fails.
errlog=$(mktemp)
trap 'rm -f "$errlog"' EXIT

set +e
if [[ "$GG_MODE" == branch ]]; then
  output=$(cd "$GG_ROOT" && npx --yes "fallow@${FALLOW_VERSION}" audit \
    --quiet --no-cache --format compact --changed-since="$GG_BASE" 2>"$errlog")
else
  output=$(cd "$GG_ROOT" && npx --yes "fallow@${FALLOW_VERSION}" \
    --quiet --no-cache --format compact 2>"$errlog")
fi
status=$?
set -e

if [[ -n "$output" ]]; then
  if [[ "$GG_MODE" == branch ]]; then
    printf '%s\n' "$output" | sed -E 's/^([^:]+) +:([0-9]+)/\1:\2:/'
  else
    printf '%s\n' "$output" | awk '
      BEGIN {
        count = split(ENVIRON["GG_FILES"], paths, "\n")
      }
      {
        kind = $0
        sub(/:.*/, "", kind)
        if (kind == "file-score" || kind == "vital-signs") next
        record = substr($0, length(kind) + 2)
        path = ""
        for (i = 1; i <= count; i++) {
          candidate = paths[i]
          if ((record == candidate || index(record, candidate ":") == 1) && length(candidate) > length(path)) path = candidate
        }
        if (path != "") {
          detail = substr(record, length(path) + 2)
          line = ""
          if (detail ~ /^[0-9]+(-[0-9]+)?:/) {
            line = detail
            sub(/:.*/, "", line)
            sub(/-.*/, "", line)
            sub(/^[^:]*:/, "", detail)
          }
          printf "%s:%s %s%s\n", path, (line == "" ? "" : line ":"), kind, (detail == "" ? "" : ":" detail)
        }
      }
    '
  fi
fi

# Fallow uses 1 for a fail verdict and 2 for its own execution errors.
# Findings are valid advisory output. Remap execution errors because gg reserves
# exit 2 specifically for unavailable runners.
if (( status == 1 )); then
  exit 0
fi
if (( status != 0 )); then
  printf 'fallow failed (exit %s): %s\n' "$status" "$(tr '\n' ' ' <"$errlog" | tail -c 300)"
  exit 3
fi
exit 0
