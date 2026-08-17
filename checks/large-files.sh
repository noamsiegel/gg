#!/usr/bin/env bash
# gg-globs: *
#
# A staged review must measure the blob in Git's index rather than the worktree
# file. A user can stage a 100 MB file and then edit the worktree copy down to
# 1 KB; Git still commits the staged 100 MB blob. Range review has the same
# provenance requirement, so it asks Git for objects introduced by the range.
# Branch and explicit-path review are the only modes where the worktree is the
# artifact under review.

set -euo pipefail

LIMIT_MB="${LARGE_FILE_LIMIT_MB:-5}"
LIMIT_BYTES=$((LIMIT_MB * 1024 * 1024))
found=0

report_large_file() {
  local path=$1
  local size=$2
  local mb

  if (( size > LIMIT_BYTES )); then
    mb=$(awk -v size="$size" 'BEGIN { printf "%.2f", size / 1048576 }')
    printf '%s: %sMB staged (>%sMB threshold)\n' "$path" "$mb" "$LIMIT_MB"
    found=1
  fi
}

cd "$GG_ROOT"

case "${GG_MODE:-}" in
  range)
    if [[ -z "${GG_RANGE:-}" ]]; then
      echo "large-files needs GG_RANGE in range mode"
      exit 1
    fi

    tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/gg-large-files.XXXXXX")
    trap 'rm -rf "$tmp_dir"' EXIT
    # GG_RANGE is a rev-list expression and may be several words, such as
    # "<sha> --not --remotes" on the first push of a new branch. It must be
    # word-split deliberately rather than passed as one argument.
    read -r -a range_args <<<"$GG_RANGE"
    if [[ $# -gt 0 ]]; then
      [[ $1 == -- ]] || {
        echo "large-files expected pathspecs after --"
        exit 1
      }
      git -C "$GG_INVOKE_DIR" -c core.quotePath=false rev-list --objects \
        "${range_args[@]}" "$@" >"$tmp_dir/objects"
    else
      git -c core.quotePath=false rev-list --objects \
        "${range_args[@]}" >"$tmp_dir/objects"
    fi
    git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
      <"$tmp_dir/objects" >"$tmp_dir/sizes"

    while IFS=' ' read -r type size path; do
      [[ "$type" == "blob" && -n "$path" ]] || continue
      report_large_file "$path" "$size"
    done <"$tmp_dir/sizes"
    ;;

  staged)
    while IFS= read -r path; do
      [[ -n "$path" ]] || continue

      staged_line=$(git ls-files --stage -- "$path" | head -n 1)
      [[ -n "$staged_line" ]] || continue
      mode=${staged_line%% *}

      # Only regular index entries represent file content. In particular,
      # 120000 is a symlink whose blob contains only its target path.
      [[ "$mode" == "100644" || "$mode" == "100755" ]] || continue

      size=$(git cat-file -s ":$path")
      report_large_file "$path" "$size"
    done <<<"${GG_FILES:-}"
    ;;

  branch|paths)
    while IFS= read -r path; do
      [[ -n "$path" ]] || continue
      [[ -f "$path" && ! -L "$path" ]] || continue
      size=$(wc -c <"$path")
      report_large_file "$path" "$size"
    done <<<"${GG_FILES:-}"
    ;;

  *)
    printf 'large-files does not support %s mode\n' "${GG_MODE:-unset}"
    exit 1
    ;;
esac

if (( found == 1 )); then
  printf 'If a file genuinely belongs in the repository, track it via Git LFS.\n' >&2
  printf 'Raise the threshold with LARGE_FILE_LIMIT_MB=20 when appropriate.\n' >&2
fi
