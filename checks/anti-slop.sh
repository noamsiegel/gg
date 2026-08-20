#!/usr/bin/env bash
# gg-globs: *.ts *.tsx *.js *.jsx *.mjs *.cjs
#
# Runs the vendored dmmulroy/anti-slop Oxlint rules over the changed JS/TS files.
# anti-slop rejects low-evidence, low-signal patterns (unparsed `unknown` inputs,
# chained/undocumented type assertions, module mocks, `object` parameters) - the
# exact residue of machine-written code that gg exists to surface before handoff.
#
# Repo-independent verdict (invariant 5 / ADR-008): the check invokes oxlint with
# gg's own config, `--disable-nested-config`, `-A all`, and every builtin plugin
# disabled, so nothing the repository under review declares can enable, silence,
# or reshape what fires. gg never reads or authors the repository's Oxlint config.
#
# Footprint stays inside gg's own checkout: the vendored plugin's single runtime
# dependency (@oxlint/plugins) is installed under checks/anti-slop/plugin, not in
# the repository under review.

set -euo pipefail

ANTI_SLOP_OXLINT_VERSION="${ANTI_SLOP_OXLINT_VERSION:-1.78.0}"

check_dir=$(cd "$(dirname "$0")" && pwd)
plugin_dir="$check_dir/anti-slop/plugin"
config="$check_dir/anti-slop/gg-oxlint.config.ts"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is not available"
  exit 2
fi

# One scratch file for the whole run: the install phase and the lint phase both
# capture stderr here, and a single EXIT trap cleans it up.
errlog=$(mktemp)
trap 'rm -f "$errlog"' EXIT

# The plugin's rule modules import @oxlint/plugins at load time, and oxlint ships
# with no dependencies, so the package must be resolvable next to the vendored
# plugin. Install it once into gg's own checkout; its presence is the sentinel.
if [[ ! -f "$plugin_dir/node_modules/@oxlint/plugins/package.json" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is not available to install the anti-slop plugin dependency"
    exit 2
  fi
  if ! (cd "$plugin_dir" && npm install --silent --no-audit --no-fund --no-package-lock) >"$errlog" 2>&1; then
    printf 'anti-slop dependencies unavailable: %s\n' "$(tr '\n' ' ' <"$errlog" | tail -c 200)"
    exit 2
  fi
fi

# gg passes changed files newline-separated in GG_FILES, already repo-relative and
# filtered to this check's globs. The working directory is the repository root.
files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && files+=("$file")
done <<< "${GG_FILES:-}"
[[ ${#files[@]} -gt 0 ]] || exit 0

set +e
output=$(npx --yes "oxlint@${ANTI_SLOP_OXLINT_VERSION}" \
  --config "$config" \
  --disable-nested-config \
  --disable-unicorn-plugin \
  --disable-oxc-plugin \
  --disable-typescript-plugin \
  --allow all \
  --format unix \
  "${files[@]}" 2>"$errlog")
status=$?
set -e

# unix format is `path:line:col: message [Error/anti-slop(rule)]` plus a trailing
# blank line and an `N problems` summary. gg presents findings as `path:line:
# message`, so drop the column, restate the rule as `[anti-slop/<rule>]`, and emit
# only real finding lines - the summary and blanks are oxlint presentation.
if [[ -n "$output" ]]; then
  printf '%s\n' "$output" | sed -nE \
    's/^([^:]+):([0-9]+):[0-9]+: (.*) \[[^]]*\(([^)]*)\)\]$/\1:\2: \3 [anti-slop\/\4]/p'
fi

# oxlint exits 1 when it found violations (valid advisory output for gg) and >1 on
# its own execution errors. gg reserves exit 2 for unavailable runners, so remap
# an execution error to the generic check-error exit (3).
if (( status == 1 )); then
  exit 0
fi
if (( status != 0 )); then
  printf 'oxlint failed (exit %s): %s\n' "$status" "$(tr '\n' ' ' <"$errlog" | tail -c 300)"
  exit 3
fi
exit 0
