# gg

`gg` is a personal reviewer for your current work. Run it on demand to inspect a branch, the index, or selected paths. It reports findings and always exits successfully, so heuristics can be useful without breaking a commit.

`gg` never installs into a repository, never writes repository files, and never touches `core.hooksPath`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/noamsiegel/gg/main/install.sh | bash
```

The installer clones to `${GG_HOME:-$HOME/.local/share/gg}` and links the executable at `${BIN_DIR:-$HOME/.local/bin}/gg`. It requires `git` and `bash`, but not `sudo`. Re-running it updates the checkout with `git pull --ff-only`.

Update later with:

```bash
gg self-update
```

## Commands

| Command | Reviews |
|---|---|
| `gg` | Current branch against the resolved base ref |
| `gg <path>...` | Specific files or directories |
| `gg --staged` | The index |
| `gg --since <ref>` | Current work against an arbitrary ref |
| `gg guard pre-push` | Push range with the two blocking publication checks |
| `gg self-update` | Installed checkout via `git pull --ff-only` |
| `gg --version` | Installed version |

Base resolution is: an explicit override, `origin/HEAD`, `origin/main`, `origin/master`, `origin/develop`, then `HEAD~1`.

Normal review commands always exit `0`, including when they find issues or a check errors. `gg guard` exits non-zero on a blocking finding.

## Review roster

| Check | Tool | Scope | What it catches |
|---|---|---|---|
| `python-bugs` | Ruff `0.14.2` via `uvx` | `*.py`, `*.pyi` | Undefined names, undefined exports, and source I/O errors using an isolated bug-only rule set |
| `dead-code` | Vulture via `uvx` | `*.py` | Likely unused Python code; scans the whole repository, then reports only findings in changed files |
| `complexity` | Radon via `uvx` | `*.py` | Complexity regressions in changed functions relative to the base |
| `architecture` | import-linter via `uvx` | `*.py` | Violated import contracts, only when the repository already provides contracts |
| `js-health` | Fallow `2.79.0` via `npx` | `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs` | Diff-relative JavaScript and TypeScript health findings |
| `secrets` | Gitleaks on `PATH` | All changed files | Secrets in current work; also runs in the blocking pre-push guard |

Missing runners do not fail a review. The summary identifies skipped checks, which is why the installer reports whether `uvx`, `npx`, and `gitleaks` are available.

## Adding a check

Each executable `checks/<name>.sh` declares its file selection in one header line:

```bash
# gg-globs: *.py *.pyi
```

Use `# gg-globs: *` to receive every changed file. The core filters the file list before invoking a check.

| Environment | Meaning |
|---|---|
| `GG_ROOT` | Absolute repository top level |
| `GG_BASE` | Resolved base ref; empty in staged and path modes |
| `GG_RANGE` | `<base>..<head>`, set only in range mode |
| `GG_FILES` | Newline-separated repository-relative paths matching the declared globs; never empty |
| `GG_MODE` | `branch`, `staged`, `paths`, or `range` |

Checks print findings only, one per line, as `path:line: message` or `path: message` when no line is available. They do not print headings, banners, summaries, or blank lines. Presentation belongs to `gg`.

| Exit | Meaning |
|---|---|
| `0` | Check ran; stdout may contain findings |
| `2` | Required runner or tool is unavailable; stdout contains one short reason |
| Any other value | Check errored; the core reports an error, not a finding |

## Blocking publication guard

One blocking remnant exists: the user's own global `pre-push` hook chain may call:

```bash
gg guard pre-push
```

It runs only secrets and large-file checks over the push range. A local commit is recoverable; a push is publication. Those two checks protect irreversible history and credential exposure, so they block before publication. No other advisory check does.

This hook is user-managed and global. `gg` does not install it, does not enter repositories, and never speaks during a commit.

## What it doesn't do

- It does not run repository-configured lint, typecheck, format, or test policy. The repository's CI already owns `ruff check`, `tsc`, `eslint`, formatters, and project-specific commands; duplicating them here is not pulling weight.
- It never authors or modifies per-repository tool configuration. A check may honor an import-linter contracts file the repository already owns.
- It does not provide a plugin framework. Executable checks and their small protocol are the extension seam.
- It does not provide server-side enforcement. Normal reviews are advisory and intentionally skippable.
