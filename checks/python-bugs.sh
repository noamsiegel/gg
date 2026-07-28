#!/usr/bin/env bash
# Config-free Python bug gate.
#
# This is NOT a lint gate. It runs a fixed, tiny set of Ruff rules that flag
# code which is broken in ANY repository, regardless of that repository's
# style policy:
#
#   F821  undefined name              (NameError at runtime)
#   F822  undefined name in __all__   (ImportError for `from mod import *`)
#   F823  local referenced before assignment (UnboundLocalError)
#   F811  redefinition of unused name (the first definition is dead)
#   E902  file could not be read/parsed
#
# Two invariants make it a user-owned safety check rather than repo policy
# (see CONTEXT.md ADR-008):
#
# 1. `--isolated` — Ruff ignores the repo's pyproject.toml/ruff.toml. Without
#    it a repo can set `[tool.ruff.lint] ignore = ["F821"]` and silence a
#    user-owned check from committed config. Verified: with repo config
#    honored, an F821 file exits 0; with --isolated it exits 1.
#
# 2. Staged blobs, not the worktree. Ruff reads paths from disk, which would
#    inspect post-stage worktree edits. We pipe `git cat-file blob :path`
#    through `--stdin-filename` so the bytes checked are the bytes committed.
#    Same invariant as checks/large-files.sh.
#
# Ruff's F-rules are single-file, so per-file stdin loses no analysis.

set -euo pipefail

# Pin for reproducibility and supply-chain safety. Override temporarily with
# RUFF_VERSION; bump this once a new release is validated.
RUFF_VERSION="${RUFF_VERSION:-0.14.2}"

# The rule set is deliberately fixed. Widening it here turns a bug gate into a
# style gate imposed on every repo you touch, which is what ADR-008 forbids.
RULES="F821,F822,F823,F811,E902"

# Strip lefthook's `--` separator if present.
[[ $# -gt 0 && "$1" == "--" ]] && shift

if [[ $# -eq 0 ]]; then
  exit 0
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "python-bugs: uvx not found; skipping. Install with: brew install uv" >&2
  exit 0
fi

fail=0
for f in "$@"; do
  # Only check paths that are actually staged; lefthook globs can pass through
  # deletions and unstaged paths.
  git ls-files --error-unmatch --cached -- "$f" >/dev/null 2>&1 || continue

  # mode 120000 = symlink; the staged blob is link text, not Python source.
  mode=$(git ls-files --stage -- "$f" | awk '{print $1}')
  [[ "$mode" == "120000" ]] && continue

  if ! git cat-file blob ":$f" 2>/dev/null | uvx "ruff@${RUFF_VERSION}" check \
      --isolated \
      --select "$RULES" \
      --no-cache \
      --quiet \
      --stdin-filename "$f" \
      -; then
    fail=1
  fi
done

if (( fail == 1 )); then
  printf '\nThese are runtime bugs, not style violations, and were found in the\n' >&2
  printf 'STAGED content. Your repo lint config is deliberately not consulted.\n' >&2
  printf '  - Bypass: SKIP_PYTHON_BUGS=1 git commit ...\n' >&2
  exit 1
fi
