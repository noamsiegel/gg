#!/usr/bin/env bash
# gg-globs: *.py
#
# This check is structurally different from the other checks: it analyzes the
# whole repository, then reports only findings in GG_FILES. Vulture needs that
# whole-program view because a function defined in a changed file can be called
# from an unchanged file; analyzing only the diff would invent a dead-code
# finding. Git supplies the input set so tracked code is included while ignored
# files and common generated or vendored directories are excluded cheaply.

set -euo pipefail

if ! command -v uvx >/dev/null 2>&1; then
  printf '%s\n' 'uvx is required for dead-code'
  exit 2
fi

cd "$GG_ROOT"
mapfile -d '' -t python_files < <(
  git ls-files -z --cached --others --exclude-standard -- '*.py' |
    while IFS= read -r -d '' path; do
      case "/$path/" in
        */.venv/*|*/node_modules/*|*/build/*|*/dist/*|*/.git/*) ;;
        *) printf '%s\0' "$path" ;;
      esac
    done
)

if (( ${#python_files[@]} == 0 )); then
  printf '%s\n' 'no Python files outside excluded directories'
  exit 2
fi

output=$(mktemp)
trap 'rm -f "$output"' EXIT

status=0
uvx "vulture@${VULTURE_VERSION:-2.14}" "${python_files[@]}" >"$output" || status=$?
# Vulture exits 3 when it found dead code. That is a successful check run.
# Vulture exits 1 on its own errors. Exit 2 is reserved for "runner unavailable"
# in the gg protocol, so remap anything unexpected to 3 rather than leaking it.
if (( status != 0 && status != 3 )); then
  cat "$output"
  exit 3
fi

# GG_FILES is newline-separated, so it must reach awk through ENVIRON rather than
# -v: awk's -v processes escape sequences and cannot carry a literal newline.
awk '
  BEGIN {
    count = split(ENVIRON["GG_FILES"], paths, "\n")
    for (i = 1; i <= count; i++) wanted[paths[i]] = 1
  }
  {
    path = $0
    sub(/:[0-9]+:.*/, "", path)
    sub(/^\.\//, "", path)
    if (wanted[path]) print
  }
' "$output"
