#!/usr/bin/env bash
# gg-globs: *.py
#
# A bare complexity score is a number, not a finding. This check is therefore
# diff-relative: it compares each function or method with the same qualified
# name at GG_BASE and reports only a worse rank. New files have no prior design
# to regress, so they are intentionally skipped.

set -euo pipefail

if ! command -v uvx >/dev/null 2>&1; then
  printf '%s\n' 'uvx is required for complexity'
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'python3 is required for complexity'
  exit 2
fi

if [[ -z "$GG_BASE" ]]; then
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# bash 3.2 (macOS default) has no mapfile.
files=()
while IFS= read -r line; do
  [[ -n "$line" ]] && files+=("$line")
done <<<"$GG_FILES"
cd "$GG_ROOT"

index=0
for path in "${files[@]}"; do
  [[ -f "$path" ]] || continue
  index=$((index + 1))
  base_source="$work/base-$index.py"
  base_json="$work/base-$index.json"
  head_json="$work/head-$index.json"

  if ! git show "$GG_BASE:$path" >"$base_source" 2>/dev/null; then
    continue
  fi

  uvx "radon@${RADON_VERSION:-6.0.1}" cc -s -j "$base_source" >"$base_json"
  uvx "radon@${RADON_VERSION:-6.0.1}" cc -s -j "$path" >"$head_json"

  python3 -c '
import json, sys

base_path, head_path, display_path = sys.argv[1:]

def entries(path):
    document = json.load(open(path, encoding="utf-8"))
    result = {}

    def visit(nodes, prefix=""):
        for node in nodes:
            name = node.get("name")
            if not name:
                continue
            qualified = f"{prefix}.{name}" if prefix else name
            kind = node.get("type")
            if kind in {"function", "method"}:
                result[qualified] = node
            visit(node.get("methods", ()), qualified)
            visit(node.get("closures", ()), qualified)

    for nodes in document.values():
        visit(nodes)
    return result

base = entries(base_path)
head = entries(head_path)
for name, current in sorted(head.items(), key=lambda item: item[1]["lineno"]):
    previous = base.get(name)
    if previous is None or current["rank"] <= previous["rank"]:
        continue
    print(
        f"{display_path}:{current['"'"'lineno'"'"']}: {name} complexity regressed "
        f"{previous['"'"'rank'"'"']} -> {current['"'"'rank'"'"']} "
        f"({previous['"'"'complexity'"'"']} -> {current['"'"'complexity'"'"']})"
    )
' "$base_json" "$head_json" "$path"
done
