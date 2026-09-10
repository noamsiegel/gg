#!/usr/bin/env bash
# gg-globs: *.ts *.tsx *.js *.jsx *.mjs *.cjs
set -euo pipefail

source "$(dirname "$0")/runners"
gg_require_runner js fallow

# Compact output is normally already path:line: message. Older compact
# renderers put a space before :line; normalize only that separator and leave
# the tool's diagnostic text intact.
# Fallow writes progress and environment warnings ("node_modules not found") to
# stderr. Merging them into stdout renders them as findings, so stderr is kept
# separate and only surfaced when fallow actually fails.
errlog=$(mktemp)
trap 'rm -f "$errlog"' EXIT

set +e
status=0
# A Git repository can contain nested JavaScript workspace roots which are not
# members of any repository-root workspace. Running Fallow only at the Git root
# discovers their files but misses their entry points, making every live file
# look unused. Select a nested Fallow root only from workspace metadata; an
# ordinary nested package stays in the enclosing Git-root graph.
analysis_projects=$(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(process.env.GG_ROOT);
  const projects = [];
  for (const file of process.env.GG_FILES.split("\n").filter(Boolean)) {
    let directory = path.dirname(path.resolve(root, file));
    let analysisRoot;
    while (directory === root || directory.startsWith(root + path.sep)) {
      const manifestPath = path.join(directory, "package.json");
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (manifest.workspaces) {
          analysisRoot = directory;
          break;
        }
      } catch {}
      if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
        analysisRoot = directory;
        break;
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
    analysisRoot ??= root;
    projects.push(`${path.relative(root, analysisRoot) || "."}\t${file}`);
  }
  process.stdout.write(projects.sort().join("\n"));
' 2>"$errlog")
root_status=$?
if (( root_status != 0 )); then
  status=3
else
  analysis_roots=$(printf '%s\n' "$analysis_projects" | cut -f 1 | sort -u)
  while IFS= read -r analysis_root; do
    [[ -n "$analysis_root" ]] || continue
    project_files=$(printf '%s\n' "$analysis_projects" | awk -F '\t' -v root="$analysis_root" '
      $1 == root {
        sub(/^[^\t]*\t/, "")
        print
      }
    ')
    if [[ "$GG_MODE" == branch ]]; then
      output=$(cd "$GG_ROOT/$analysis_root" && "$runner" audit \
        --quiet --no-cache --format compact --changed-since="$GG_BASE" 2>>"$errlog")
    else
      output=$(cd "$GG_ROOT/$analysis_root" && "$runner" \
        --quiet --no-cache --format compact 2>>"$errlog")
    fi
    root_status=$?
    if (( root_status > status )); then
      status=$root_status
    fi
    [[ -n "$output" ]] || continue
    if [[ "$analysis_root" == "." ]]; then
      project_prefix=""
    else
      project_prefix="$analysis_root/"
    fi
    if [[ "$GG_MODE" == branch ]]; then
      printf '%s\n' "$output" |
        sed -E 's/^([^:]+) +:([0-9]+)/\1:\2:/' |
        GG_PROJECT_FILES="$project_files" GG_PROJECT_PREFIX="$project_prefix" awk '
          BEGIN {
            count = split(ENVIRON["GG_PROJECT_FILES"], paths, "\n")
            prefix = ENVIRON["GG_PROJECT_PREFIX"]
          }
          {
            raw = $0
            kind = raw
            sub(/:.*/, "", kind)
            record = prefix substr(raw, length(kind) + 2)
            path = ""
            for (i = 1; i <= count; i++) {
              candidate = paths[i]
              if ((record == candidate || index(record, candidate ":") == 1) && length(candidate) > length(path)) path = candidate
            }
            if (path != "") {
              detail = substr(record, length(path) + 2)
              line = ""
              if (detail ~ /^[0-9]+(-[0-9]+)?:/) {
                line = detail
                sub(/:.*/, "", line)
                sub(/-.*/, "", line)
                sub(/^[^:]*:/, "", detail)
              }
              printf "%s:%s %s%s\n", path, (line == "" ? "" : line ":"), kind, (detail == "" ? "" : ":" detail)
              next
            }
            record = prefix raw
            for (i = 1; i <= count; i++) {
              candidate = paths[i]
              if (record == candidate || index(record, candidate ":") == 1) {
                print record
                next
              }
            }
          }
        '
    else
      printf '%s\n' "$output" | GG_PROJECT_FILES="$project_files" GG_PROJECT_PREFIX="$project_prefix" awk '
        BEGIN {
          count = split(ENVIRON["GG_PROJECT_FILES"], paths, "\n")
          prefix = ENVIRON["GG_PROJECT_PREFIX"]
        }
        {
          kind = $0
          sub(/:.*/, "", kind)
          if (kind == "file-score" || kind == "vital-signs") next
          record = prefix substr($0, length(kind) + 2)
          path = ""
          for (i = 1; i <= count; i++) {
            candidate = paths[i]
            if ((record == candidate || index(record, candidate ":") == 1) && length(candidate) > length(path)) path = candidate
          }
          if (path != "") {
            detail = substr(record, length(path) + 2)
            line = ""
            if (detail ~ /^[0-9]+(-[0-9]+)?:/) {
              line = detail
              sub(/:.*/, "", line)
              sub(/-.*/, "", line)
              sub(/^[^:]*:/, "", detail)
            }
            printf "%s:%s %s%s\n", path, (line == "" ? "" : line ":"), kind, (detail == "" ? "" : ":" detail)
          }
        }
      '
    fi
  done <<< "$analysis_roots"
fi
set -e

# Fallow uses 1 for a fail verdict and 2 for its own execution errors.
# Findings are valid advisory output. Remap execution errors because gg reserves
# exit 2 specifically for unavailable runners.
if (( status == 1 )); then
  exit 0
fi
if (( status != 0 )); then
  printf 'fallow failed (exit %s): %s\n' "$status" "$(tr '\n' ' ' <"$errlog" | tail -c 300)"
  exit 3
fi
exit 0
