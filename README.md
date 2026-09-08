# gg

`gg` is a personal reviewer for your current work. Run it on demand to inspect a branch, the index, or selected paths. Findings remain advisory; incomplete execution returns nonzero so automation can distinguish a review from a failed attempt.

`gg` never installs into a repository, never writes repository files, and never touches `core.hooksPath`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/noamsiegel/gg/main/install.sh | bash
```

The installer clones to `${GG_HOME:-$HOME/.local/share/gg}` and links the executable at `${BIN_DIR:-$HOME/.local/bin}/gg`. It requires `git` and `bash`, but not `sudo`. Re-running it installs the latest published stable release. Local modifications or commits outside the release history are preserved by refusing the update.

Update later with:

```bash
gg self-update
```

## Commands

| Command | Reviews |
|---|---|
| `gg` | Current branch against the resolved base ref |
| `gg <path>...` | Specific files or directories |
| `gg --staged [-- <pathspec>...]` | The index, optionally scoped |
| `gg --since <ref>` | Current work against an arbitrary ref |
| `gg guard pre-push [-- <pathspec>...]` | Push range with the two blocking publication checks, optionally scoped |
| `gg self-update` | Latest published stable release |
| `gg --version` | Installed version and Git revision |
| `gg setup` | Explicitly prepare pinned analysis runners |
| `gg --json [review arguments]` | Structured results for agents |
| `gg --timeout <seconds> [review arguments]` | Bound each check (default 120 seconds) |

Base resolution is: an explicit override, `origin/HEAD`, `origin/main`, `origin/master`, `origin/develop`, then `HEAD~1`.

Scoped staged and pre-push forms require the `--` separator. Git interprets each pathspec relative to the directory where `gg` was invoked and applies it while reading the index or pushed commit range. Forms without pathspecs keep their full existing scope.

All staged checks read a temporary snapshot of the entire Git index. Unstaged repairs cannot hide staged defects, and unchanged indexed imports retain context. The snapshot has its own Git index and references shared read-only objects for baseline comparisons. Ignored dependencies and untracked files are not copied; dependency installation and runtime verification remain outside this static review.

JavaScript health uses Fallow's combined analysis for `--staged` and selected paths, reporting findings only in selected files, including existing findings. Branch mode keeps the base-relative audit. `NO_COLOR` disables terminal colors when nonempty.

### Runner setup and lifecycle

Install `uv`, `bun`, `node`, GNU `timeout` (`coreutils`; `gtimeout` is also accepted), and `gitleaks` through your package manager, then run `gg setup`. Setup installs pinned analysis tools under `${GG_TOOLS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/gg-tools}` and prepares the vendored plugin inside GG's installation. Reviews invoke these prepared binaries directly and never run package managers. Missing runners produce an actionable skip. `jq` is required only for JSON output and automatic update detection.

Every check has a 120-second deadline, adjustable with `--timeout`. GNU timeout terminates the process group and escalates after two seconds. Ctrl-C exits 130, stops child work and removes the review snapshot. A timeout is an error with incomplete coverage. Ordinary findings remain advisory; an unavailable publication check blocks the push guard because it did not establish safety.

### Results for agents

`gg --json --staged` emits JSON on stdout with `schema_version: 1`, `mode`, `base`, `update`, `checks`, and `summary`. Each check has `name`, `status` (`completed`, `not_applicable`, `skipped`, or `error`), and either `findings` (strings) or `reason`. The summary includes counts and `coverage_complete`. No matching checks produces an empty array. A branch with no resolvable base produces incomplete coverage and a reason. Invalid CLI arguments still fail on stderr. The pre-push guard emits one JSON object per reviewed ref when JSON is requested.

Human summaries explicitly say `coverage incomplete` for skipped or errored checks. Zero findings does not mean every check ran.

### Update notices

Normal reviews check public GitHub stable-release metadata at most once per 24 hours per installed revision, with a two-second network bound. An available update appears on stderr, including in non-interactive use, and in the JSON `update` field with `command: "gg self-update"`. Failed/offline checks report `unknown` and are cached too. CI and push guards do not check online. Set `GG_NO_UPDATE_CHECK=1` to disable checks; no repository code or data is sent. Cache lives under `${XDG_CACHE_HOME:-$HOME/.cache}/gg`. Updates are never installed automatically. Older GG versions without this notifier need a one-time `gg self-update` before they can show notices.

Normal reviews exit `0` when applicable checks complete, even with findings; exit `2` means incomplete execution (missing runner, failed check, timeout, or missing baseline for branch selection). Invalid usage exits `1`; cancellation exits `130`/`143`. Checks that do not apply are excluded from required coverage. `gg guard` retains exit `1` for blocking findings or unavailable protection.

## Review roster

| Check | Tool | Scope | What it catches |
|---|---|---|---|
| `python-bugs` | Ruff `0.14.2` prepared by `gg setup` | `*.py`, `*.pyi` | Undefined names, undefined exports, and source I/O errors using an isolated bug-only rule set |
| `dead-code` | Vulture prepared by `gg setup` | `*.py` | Likely unused Python code; scans the whole repository, then reports only findings in changed files |
| `complexity` | Radon prepared by `gg setup` | `*.py` | Complexity regressions in changed functions relative to the base |
| `architecture` | import-linter prepared by `gg setup` | `*.py` | Violated import contracts, only when the repository already provides contracts |
| `js-health` | Prepared Fallow `2.79.0` | `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs` | Base-relative findings for branches; whole-project analysis filtered to selected files for paths and the index |
| `anti-slop` | Prepared Oxlint `1.78.0` with vendored [anti-slop](https://github.com/dmmulroy/anti-slop) rules | `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs` | Low-evidence patterns: unparsed `unknown`/`object` inputs, chained or undocumented type assertions, `unknown`-valued dictionaries, module mocks. Runs a fixed rule set with the repository's own Oxlint config ignored |
| `secrets` | Gitleaks on `PATH` | All changed files | Secrets in current work; also runs in the blocking pre-push guard |

Missing prepared runners make review execution incomplete and return exit `2`; their reasons are explicit. Setup is the only analysis-package-installing operation. Run `gg setup` again to prepare a changed pin after updating GG.

## Adding a check

Each executable `checks/<name>.sh` declares its file selection in one header line:

```bash
# gg-globs: *.py *.pyi
```

Use `# gg-globs: *` to receive every changed file. The core filters the file list before invoking a check.

| Environment | Meaning |
|---|---|
| `GG_ROOT` | Absolute repository top level |
| `GG_INVOKE_DIR` | Absolute directory where `gg` was invoked |
| `GG_BASE` | Resolved base in branch mode; staged checks receive the snapshot HEAD; empty otherwise |
| `GG_RANGE` | Git revision expression in range mode; pre-push uses `<local-sha> --not --remotes`; empty otherwise |
| `GG_LOCAL_REF` | Exact local ref token from pre-push stdin; empty outside the guard |
| `GG_FILES` | Newline-separated repository-relative Git paths matching the declared globs; never empty and may name deleted range files |
| `GG_MODE` | `branch`, `staged`, `paths`, or `range` |
Checks print findings only, one per line, as `path:line: message` or `path: message` when no line is available. They do not print headings, banners, summaries, or blank lines. Presentation belongs to `gg`.

For scoped staged and pre-push reviews, checks also receive the unchanged separator and pathspec arguments as `-- <pathspec>...`. Checks that produce their own Git input must apply those arguments or the Git-produced `GG_FILES` as literal top-level pathspecs, never filter worktree output.

| Exit | Meaning |
|---|---|
| `0` | Check ran; stdout may contain findings |
| `2` | Required runner or tool is unavailable; stdout contains one short reason |
| `4` | Check does not apply; stdout explains why and coverage remains complete |
| Any other value | Check errored; the core reports an error, not a finding |

## Blocking publication guard

One blocking remnant exists: the user's own global `pre-push` hook chain may call:

```bash
gg guard pre-push
gg guard pre-push -- apps/hoa
```

It runs only secrets and large-file checks over the push range. The scoped form still scans selected history, including a secret or large blob introduced and deleted within that range. A local commit is recoverable; a push is publication. Those two checks protect irreversible history and credential exposure, so they block before publication. No other advisory check does.

This global hook is user-managed; `gg` does not install hooks or enter repositories. Repository-owned hooks may invoke advisory review modes, but must distinguish advisory findings (exit `0`) from incomplete execution (exit `2`).

## What it doesn't do

- It does not run repository-configured lint, typecheck, format, or test policy. The repository's CI already owns `ruff check`, `tsc`, `eslint`, formatters, and project-specific commands; duplicating them here is not pulling weight.
- It never authors or modifies per-repository tool configuration. A check may honor an import-linter contracts file the repository already owns.
- It does not provide a plugin framework. Executable checks and their small protocol are the extension seam.
- It does not provide server-side enforcement. Normal reviews are advisory and intentionally skippable.

## Release policy

Stable tags use `vMAJOR.MINOR.PATCH` matching `GG_VERSION`. Tag CI runs the full suite before publishing the GitHub release. Install, self-update, and update notices use the latest published non-prerelease release, never the moving main branch. No release means installation fails with an actionable error rather than silently installing development code. Version 2 changes execution exit codes; callers that previously assumed every review succeeded must handle exit 2 or inspect JSON coverage.

## Agent ergonomics

Reviews show up to 100 findings per check and 1,000 characters per line by default, with explicit omission markers and unchanged total counts. `--full` restores all output. JSON is compact, retains structured statuses, and includes contextual help. Usage failures under `--json` have a structured `error`; `setup --help`, `self-update --help`, and `guard --help` are read-only discovery commands.

[AXI principles](https://axi.md/) assessment (2026-09-08):

- Efficiency: compact JSON and concise text; keep the existing format instead of adding TOON dependencies.
- Small records: each check reports name, status, and findings/reason.
- Bounds: explicit truncation plus `--full`.
- Aggregates: total findings and coverage counters.
- Empty results: explicit zero-count summary.
- Errors: machine-readable usage/check failures and nonzero execution status.
- Context: on-demand `gg`; no harness hooks, per repository policy.
- Content first: bare `gg` reviews current work.
- Guidance: contextual next steps accompany results.
- Help: subcommands expose read-only help.

These are applicable principles, not a claim of literal AXI format compliance. JSON compatibility and the no-hooks policy remain intentional. External Git/network setup failures can still originate on stderr; review errors are structured.
