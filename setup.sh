#!/usr/bin/env bash
# Explicit dependency preparation. Review commands never run this script.
set -euo pipefail
setup_dir=$(cd "$(dirname "$0")" && pwd)
source "$setup_dir/checks/runners"

for command in uv bun node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'gg setup: %s is required; install it and rerun gg setup\n' "$command" >&2
    exit 1
  fi
done

mkdir -p "$gg_tools_dir/js"
if [[ ! -x "$gg_tools_dir/python/bin/python" ]]; then
  uv venv "$gg_tools_dir/python"
fi
uv pip install --python "$gg_tools_dir/python/bin/python" \
  'ruff==0.14.2' 'vulture==2.14' 'radon==6.0.1' 'import-linter==2.3'
bun add --cwd "$gg_tools_dir/js" --exact --trust 'fallow@2.79.0' 'oxlint@1.78.0'

# Preserve an already-prepared plugin, including user-owned node_modules links.
plugin_dir="$setup_dir/checks/anti-slop/plugin"
if [[ ! -f "$plugin_dir/node_modules/@oxlint/plugins/package.json" ]]; then
  bun install --cwd "$plugin_dir" --no-save
fi
"$gg_tools_dir/js/node_modules/.bin/fallow" --version
"$gg_tools_dir/js/node_modules/.bin/oxlint" --version
printf 'gg setup: runners prepared in %s\n' "$gg_tools_dir"
if ! command -v gitleaks >/dev/null 2>&1; then
  printf '%s\n' 'gg setup: gitleaks is missing from PATH; install it to enable secrets review'
fi
