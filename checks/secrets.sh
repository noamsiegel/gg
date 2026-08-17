#!/usr/bin/env bash
# gg-globs: *
#
# Range scans must inspect Git history, not merely the checked-out tree: a
# secret can be introduced and removed in separate commits while remaining in
# the range being published. Other review modes intentionally copy only gg's
# selected files into an isolated tree. Besides preserving repo-relative path
# attribution, that prevents a repository-local gitleaks configuration from
# weakening the personal review policy.

set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not available"
  exit 2
fi

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/gg-secrets.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/report.tmpl" <<'EOF'
{{- range . }}{{ .File }}:{{ .StartLine }}: {{ .RuleID }} {{ .Description }}
{{ end -}}
EOF

report="$tmp_dir/findings.txt"
stderr_log="$tmp_dir/gitleaks.err"

# `--report-template` is inert unless `--report-format template` accompanies it.
# Without the format flag gitleaks exits fatally, writes no report at all, and a
# naive reading of its exit status reports the repository as clean. Verified
# against gitleaks 8.30.1; a silent false "no secrets" is the worst failure this
# check has, so the report file's existence is treated as part of the verdict.
report_args=(
  --no-banner
  --report-format template
  --report-template "$tmp_dir/report.tmpl"
  --report-path "$report"
)

set +e
if [[ -n "${GG_RANGE:-}" ]]; then
  history_root="$tmp_dir/repository.git"
  if [[ $# -gt 0 ]]; then
    [[ $1 == -- ]] || {
      printf 'secrets expected pathspecs after --\n' >"$stderr_log"
      status=3
    }
    if [[ ${status:-0} -eq 0 ]]; then
      shift
      range_args=()
      read -r -a range_args <<<"$GG_RANGE"
      source_ref=$(git -C "$GG_INVOKE_DIR" rev-parse --symbolic-full-name \
        "$GG_LOCAL_REF" 2>>"$stderr_log")
      if [[ -z "$source_ref" ]]; then
        printf 'cannot map local ref to an exportable ref: %s\n' "$GG_LOCAL_REF" >>"$stderr_log"
        status=3
      fi
    fi
    if [[ ${status:-0} -eq 0 ]]; then
      resolved_sha=$(git -C "$GG_INVOKE_DIR" rev-parse --verify "$source_ref" 2>>"$stderr_log")
      if [[ "$resolved_sha" != "${range_args[0]}" ]]; then
        printf 'local ref moved: %s resolved to %s, expected %s\n' \
          "$GG_LOCAL_REF" "$resolved_sha" "${range_args[0]}" >>"$stderr_log"
        status=3
      fi
    fi
    if [[ ${status:-0} -eq 0 ]]; then
      source_type=$(git -C "$GG_INVOKE_DIR" cat-file -t "$source_ref" 2>>"$stderr_log")
      case "$source_type" in
        commit) export_namespace=refs/heads ;;
        tag) export_namespace=refs/tags ;;
        *)
          printf 'unsupported local ref object type: %s\n' "${source_type:-unknown}" >>"$stderr_log"
          status=3
          ;;
      esac
    fi
    if [[ ${status:-0} -eq 0 ]]; then
      export_ref="$export_namespace/gg-scope-$resolved_sha"
      export_suffix=0
      while git -C "$GG_INVOKE_DIR" show-ref --verify --quiet "$export_ref" &&
        [[ "$export_ref" != "$source_ref" ]]; do
        export_suffix=$((export_suffix + 1))
        export_ref="$export_namespace/gg-scope-$resolved_sha-$export_suffix"
      done
    fi
    if [[ ${status:-0} -eq 0 ]]; then
      pathspecs=()
      while IFS= read -r path; do
        [[ -n "$path" ]] || continue
        pathspecs+=(":(top,literal)$path")
      done <<<"${GG_FILES:-}"
      if [[ ${#pathspecs[@]} -eq 0 ]]; then
        printf 'scoped history needs at least one Git-produced path\n' >>"$stderr_log"
        status=3
      fi
    fi
    if [[ ${status:-0} -eq 0 ]]; then
      git init --quiet --bare "$history_root" 2>>"$stderr_log"
      status=$?
    fi
    if [[ $status -eq 0 ]]; then
      # Export every ref for the selected literal paths so remote boundary
      # parentage survives rewriting. Gitleaks then scans only commits the push
      # introduces, never the root snapshot fast-export synthesizes for a range.
      # Keep an annotated pushed tag pointed at its nearest exported ancestor;
      # unrelated filtered tags must not abort this temporary history export.
      git -C "$GG_INVOKE_DIR" fast-export \
        --signed-tags=strip \
        --tag-of-filtered-object=rewrite \
        "--refspec=$source_ref:$export_ref" \
        --all -- "${pathspecs[@]}" 2>>"$stderr_log" |
        git -C "$history_root" fast-import --quiet 2>>"$stderr_log"
      status=$?
    fi
    if [[ $status -eq 0 ]]; then
      git -C "$history_root" rev-parse --verify --quiet \
        "$export_ref" >/dev/null 2>>"$stderr_log"
      status=$?
      if [[ $status -ne 0 ]]; then
        printf 'local ref was filtered from scoped history: %s\n' "$GG_LOCAL_REF" >>"$stderr_log"
      fi
    fi
    if [[ $status -eq 0 ]]; then
      env -u GITLEAKS_CONFIG -u GITLEAKS_CONFIG_TOML gitleaks detect \
        --source "$history_root" \
        --log-opts="$export_ref --not --remotes" \
        "${report_args[@]}" >/dev/null 2>>"$stderr_log"
      status=$?
    fi
  else
    # `--mirror`, not `--bare`: a bare clone maps the source's branches into
    # refs/heads and carries NO refs/remotes at all, so a range that excludes what
    # remotes already have (`<sha> --not --remotes`) silently matches nothing to
    # exclude and degenerates into "everything reachable from <sha>". Pushing a
    # branch that merged upstream forward then scans the entire upstream history and
    # blocks on somebody else's already-published file. `--mirror` maps every ref
    # verbatim, remote-tracking refs included, so the exclusion resolves here the
    # same way it does in the working repository.
    git clone --quiet --mirror --no-local "$GG_ROOT" "$history_root" 2>>"$stderr_log"
    env -u GITLEAKS_CONFIG -u GITLEAKS_CONFIG_TOML gitleaks detect \
      --source "$history_root" \
      --log-opts="$GG_RANGE" \
      "${report_args[@]}" >/dev/null 2>>"$stderr_log"
    status=$?
  fi
else
  scan_root="$tmp_dir/source"
  mkdir -p "$scan_root"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    [[ -f "$GG_ROOT/$path" || -L "$GG_ROOT/$path" ]] || continue
    mkdir -p "$scan_root/$(dirname "$path")"
    cp -P "$GG_ROOT/$path" "$scan_root/$path"
  done <<<"${GG_FILES:-}"

  # Scan from inside the staging tree with `--source .` so gitleaks emits paths
  # relative to it, which are exactly the repo-relative paths gg passed in.
  # Passing an absolute --source makes every finding carry the temp directory,
  # and prefix-stripping it is unreliable because macOS resolves /var through a
  # /private symlink that gitleaks may or may not expand.
  (
    cd "$scan_root"
    env -u GITLEAKS_CONFIG -u GITLEAKS_CONFIG_TOML gitleaks detect \
      --source . \
      --no-git \
      "${report_args[@]}"
  ) >/dev/null 2>>"$stderr_log"
  status=$?
fi
set -e

# 0 = clean, 1 = leaks found. Anything else, or a missing report, means gitleaks
# never produced a verdict; that must surface as a check error rather than pass
# as clean. gg reserves exit 2 for an unavailable runner, so errors exit 3.
if (( status != 0 && status != 1 )) || [[ ! -f "$report" ]]; then
  printf 'gitleaks failed (exit %s): %s\n' "$status" "$(tr '\n' ' ' <"$stderr_log" | tail -c 300)"
  exit 3
fi

while IFS= read -r finding; do
  [[ -n "$finding" ]] || continue
  printf '%s\n' "$finding"
done <"$report"

exit 0
