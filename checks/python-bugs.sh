#!/usr/bin/env bash
# gg-globs: *.py *.pyi
#
# This check asks whether changed Python is broken, not whether it follows the
# repository's lint policy. `--isolated` remains important in an advisory tool:
# a repository's ignore list answers a different question and must not hide an
# undefined name or unreadable source file from this review.
#
# F821, F822, and E902 cover unresolved names, undefined `__all__` entries, and
# source Ruff cannot read. F811 and F823 are deliberately excluded: they fire on
# decorator-registered handlers that legitimately share a name (two `@app.route`
# functions called `handler`), where the program is correct and the finding is
# simply wrong. Host runtimes inject a few legitimate globals without definitions
# in source; declaring that fixed set inline avoids false positives in Sphinx
# `conf.py` and IPython startup files without excluding either file wholesale.
#
# The `builtins = [...]` spelling is load-bearing and verified: Ruff rejects
# `lint.builtins=[...]` as an unknown field, and the failure mode is a check that
# errors on every invocation.

set -euo pipefail

if ! command -v uvx >/dev/null 2>&1; then
  printf '%s\n' 'uvx is required for python-bugs'
  exit 2
fi

mapfile -t files <<<"$GG_FILES"
output=$(mktemp)
trap 'rm -f "$output"' EXIT

cd "$GG_ROOT"
status=0
uvx "ruff@${RUFF_VERSION:-0.14.2}" check \
  --isolated \
  --no-cache \
  --quiet \
  --select 'F821,F822,E902' \
  --config 'builtins = ["get_ipython","display","tags","__IPYTHON__","reveal_type"]' \
  --output-format concise \
  -- "${files[@]}" >"$output" 2>&1 || status=$?

# Ruff uses 1 for findings and 2 for its own invocation errors. Exit 2 means
# "runner unavailable" in the gg protocol, so a Ruff error must NOT pass through
# as 2 - that would silently report a broken check as a skipped one.
if (( status == 1 )); then
  sed -E 's/^(.+):([0-9]+):[0-9]+: (.*)$/\1:\2: \3/' "$output"
  exit 0
fi
if (( status == 0 )); then
  exit 0
fi
cat "$output"
exit 3
