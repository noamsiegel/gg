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
snapshot_git=(env GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null "${isolated_git[@]}" -C "$snapshot" -c core.autocrlf=false)
# A filesystem can hold fewer names than an index: on case-insensitive APFS,
# `LOA.pdf` and `loa.pdf` are one file. Without --force the first such pair
# aborts the whole checkout; with it, each shared name holds exactly one
# entry's bytes. Real write failures still exit nonzero.
"${snapshot_git[@]}" checkout-index --all --force --ignore-skip-worktree-bits
# The filesystem, not a reimplementation of its case or Unicode folding, decides
# which entries it could not hold. Checkout-index leaves no stat data, so the
# refresh compares every entry's content; whatever still differs is printed
# for the core, which refuses to review those paths from this snapshot.
"${snapshot_git[@]}" update-index -q --refresh >/dev/null
"${snapshot_git[@]}" -c core.quotePath=false diff-files --name-only
