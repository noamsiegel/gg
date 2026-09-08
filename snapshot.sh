#!/usr/bin/env bash
set -euo pipefail
source_root=$1
snapshot=$2
# Shared objects are read-only; the snapshot owns its index and configuration.
git clone --quiet --shared --no-checkout -- "$source_root" "$snapshot"
git -C "$source_root" ls-files --stage -z | git -C "$snapshot" update-index -z --index-info
# Higher-precedence attributes prevent checkout filters from changing indexed bytes.
mkdir -p "$snapshot/.git/info"
printf '%s\n' '* -text -eol -filter -ident -working-tree-encoding' >"$snapshot/.git/info/attributes"
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -C "$snapshot" -c core.autocrlf=false checkout-index --all --ignore-skip-worktree-bits
