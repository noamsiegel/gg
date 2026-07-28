#!/usr/bin/env bash
# gg-globs: *.py
#
# Import boundaries are repository-specific, so this check runs only when the
# repository already owns import-linter contracts. It never creates or infers a
# contracts file. Import-linter does not report source locations; findings use
# the deliberate format deviation `<contract name>: <violation>` instead of
# `path:line: message`.

set -euo pipefail

if ! command -v uvx >/dev/null 2>&1; then
  printf '%s\n' 'uvx is required for architecture'
  exit 2
fi

cd "$GG_ROOT"
has_contracts=0
if [[ -f .importlinter ]]; then
  has_contracts=1
elif [[ -f setup.cfg ]] && grep -Eq '^[[:space:]]*\[importlinter\][[:space:]]*$' setup.cfg; then
  has_contracts=1
elif [[ -f pyproject.toml ]] && grep -Eq '^[[:space:]]*\[tool\.importlinter\][[:space:]]*$' pyproject.toml; then
  has_contracts=1
fi

if (( has_contracts == 0 )); then
  printf '%s\n' 'no import-linter contracts in this repo'
  exit 2
fi

output=$(mktemp)
trap 'rm -f "$output"' EXIT
status=0
uvx --from "import-linter@${IMPORT_LINTER_VERSION:-2.3}" lint-imports --no-cache >"$output" || status=$?

# Import-linter uses 1 for broken contracts. Its dashed sections contain the
# contract name followed by the human-readable violation details.
if (( status == 1 )); then
  awk '
    /^-+$/ {
      if (state == 0 || state == 3) state = 1
      else if (state == 2) state = 3
      next
    }
    state == 1 && NF {
      contract = $0
      state = 2
      next
    }
    state == 3 && NF && $0 !~ /^Broken contracts:/ && $0 !~ /^Contracts:/ {
      print contract ": " $0
    }
  ' "$output"
  exit 0
fi
if (( status == 0 )); then
  exit 0
fi
exit "$status"
