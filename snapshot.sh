#!/usr/bin/env bash
set -euo pipefail
source_root=$1
snapshot=$2
isolated_git=(env)
while IFS= read -r name; do isolated_git+=(-u "$name"); done \
  < <(git -C "$source_root" rev-parse --local-env-vars)
isolated_git+=(git)
# Shared objects are read-only; the snapshot owns its index and configuration.
"${isolated_git[@]}" clone --quiet --shared --no-checkout -- "$source_root" "$snapshot"
# Preserve the caller's selected index only while reading source entries.
git -C "$source_root" ls-files --stage -z | "${isolated_git[@]}" -C "$snapshot" update-index -z --index-info
# Higher-precedence attributes prevent checkout filters from changing indexed bytes.
mkdir -p "$snapshot/.git/info"
printf '%s\n' '* -text -eol -filter -ident -working-tree-encoding' >"$snapshot/.git/info/attributes"
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null "${isolated_git[@]}" -C "$snapshot" -c core.autocrlf=false checkout-index --all --ignore-skip-worktree-bits
