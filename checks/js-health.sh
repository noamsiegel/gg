#!/usr/bin/env bash
# gg-globs: *.ts *.tsx *.js *.jsx *.mjs *.cjs
#
# Fallow owns diff attribution itself, so giving it the same resolved base as gg
# preserves its whole-program analysis while keeping the report scoped to the
# work under review. Fallow 2.79 has no direct-file audit mode; pretending that
# staged or path input is a branch diff would produce findings for the wrong
# changeset, so those modes are reported as unavailable instead.

set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is not available"
  exit 2
fi

if [[ -z "${GG_BASE:-}" ]]; then
  printf 'fallow needs a base ref; not available in %s mode\n' "${GG_MODE:-unknown}"
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
output=$(cd "$GG_ROOT" && npx --yes "fallow@${FALLOW_VERSION}" audit \
  --quiet \
  --format compact \
  --changed-since="$GG_BASE" 2>"$errlog")
status=$?
set -e

if [[ -n "$output" ]]; then
  printf '%s\n' "$output" | sed -E 's/^([^:]+) +:([0-9]+)/\1:\2:/'
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
