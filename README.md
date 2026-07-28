# git-guardrails

> Personal Git safety layer. Installs per-repo with safe ownership marker.

`git-guardrails` installs a curated set of user-owned Git safety checks into each repo you opt in. It composes cleanly with Husky, lefthook, the pre-commit framework, or no other hook system.

## What it runs

User-owned safety checks:

| Hook | Command | Skip env | Rationale |
|---|---|---|---|
| `pre-push` | `branch-guard` | `SKIP_BRANCH_GUARD` | Block pushes to protected refs (`main`, `master`, `prod*`) |
| `pre-commit` | `large-files` | `SKIP_LARGE_FILES` | Refuse staged blobs over `MAX_BLOB_SIZE` |
| `pre-commit` | `gitleaks` | `SKIP_GITLEAKS` | Detect secrets in staged changes |
| `pre-commit` | `actionlint` | `SKIP_ACTIONLINT` | Validate `.github/workflows` YAML |
| `pre-commit` | `python-bugs` | `SKIP_PYTHON_BUGS` | Flag staged Python that is broken in any repo (`F821`/`F822`/`F823`/`F811`/`E902`) |
| `commit-msg` | `commitlint` | `SKIP_COMMITLINT` | Enforce Conventional Commits format |
| `pre-push` | `fallow` | `SKIP_FALLOW` | Run universal code-health gate for JS/TS |

## What it doesn't do

- It does not replace repo-owned lint, format, typecheck, test suites, or project-specific CI; `ruff check`, `biome`, `ty`, `eslint`, `prettier`, `tsc`, `mypy`, `vitest`, and custom commands stay in each repo's own hooks or CI. The bar is a repo-independent verdict, not the tool: `python-bugs` uses Ruff as an engine but runs `--isolated` over a fixed bug-only rule set, so it never reads or enforces repo style policy.
- It does not offer a plugin framework. The curated universal registry is the product boundary.
- It does not trust repo-local config to weaken user-owned safety checks; opt-out lives under `~/.config/git-guardrails/`, not in the repo.
- It does not hide or replace existing hook managers. It installs safely beside them or prints compose snippets for explicit chaining.
- It does not provide server-side enforcement. Client hooks remain bypassable with `--no-verify`; mirror critical policies in CI or protected-branch rules when needed.

## Install

```bash
brew tap noamsiegel/tap
brew install noamsiegel/tap/git-guardrails
```

That puts `git-guardrails` on `PATH` at `/opt/homebrew/bin/git-guardrails`. Then in each repo you want enrolled:

```bash
cd <some-repo>
git-guardrails install
```

That writes hook shims into `.git/hooks/{pre-commit,pre-push,commit-msg}` with ownership marker (`# git-guardrails-managed: git-guardrails.v0`) and sets local `core.hooksPath` to point at them. The shims invoke `git-guardrails run <hook>` which delegates to `lefthook` with the shipped config.

To enroll new clones automatically:

```bash
git-guardrails --global-template
```

That wires `git config --global init.templateDir` so every subsequent `git init` / `git clone` installs git-guardrails hooks.

## Commands

```bash
git-guardrails install [--force] [--skip <hook>]   # install hooks in current repo
git-guardrails uninstall                            # remove only ours-marked hooks
git-guardrails doctor                               # audit current repo + tool reachability
git-guardrails run <hook>                           # invoked by installed shims
git-guardrails --global-template                    # auto-install on new clones
git-guardrails --version
```

`git-guardrails install` is conflict-aware: it refuses to clobber non-git-guardrails hooks unless you pass `--force`, and it detects Husky/lefthook/pre-commit configs in the repo and prints a canonical compose snippet if you'd rather chain than override. Embedded shims preserve `"$@"`, propagate failures, and leave stdin untouched (required for `pre-push` ref lines).

## Compose snippets

`pre-commit`:

```bash
# git-guardrails compose: pre-commit
# Preserves "$@" and stdin; exits non-zero if git-guardrails blocks.
if command -v git-guardrails >/dev/null 2>&1; then
  git-guardrails run pre-commit "$@" || exit $?
fi
```

`pre-push`:

```bash
# git-guardrails compose: pre-push
# Preserves "$@" and stdin; exits non-zero if git-guardrails blocks.
if command -v git-guardrails >/dev/null 2>&1; then
  git-guardrails run pre-push "$@" || exit $?
fi
```

`commit-msg`:

```bash
# git-guardrails compose: commit-msg
# Preserves "$@" and stdin; exits non-zero if git-guardrails blocks.
if command -v git-guardrails >/dev/null 2>&1; then
  git-guardrails run commit-msg "$@" || exit $?
fi
```

## Bypass

| Goal | How |
|---|---|
| Skip one check, once | `SKIP_GITLEAKS=1 git commit ...` (also `SKIP_ACTIONLINT`, `SKIP_LARGE_FILES`, `SKIP_COMMITLINT`, `SKIP_BRANCH_GUARD`, `SKIP_FALLOW`, `SKIP_PYTHON_BUGS`) |
| Allow push to protected branch once | `ALLOW_PROTECTED_PUSH=1 git push ...` |
| Raise large-file threshold | `LARGE_FILE_LIMIT_MB=20 git commit ...` |
| Pin fallow to a different version | `FALLOW_VERSION=2.45.0 git push ...` |
| Pin ruff to a different version | `RUFF_VERSION=0.13.0 git commit ...` |
| Skip all git-guardrails checks for one invocation | `GIT_GUARDRAILS_SKIP=1 git commit ...` |
| Opt out a repo permanently | Add canonical path to `~/.config/git-guardrails/.opt-out`, one per line |
| Override PATH for non-standard tool locations | Drop `~/.config/git-guardrails/init.sh` to extend `PATH` (asdf/mise/nvm) |
| Skip everything (git-guardrails AND repo hooks) | `git commit --no-verify` / `git push --no-verify` |

There is deliberately no in-repo opt-out marker. A repository must not be able to disable user-level security checks by committing a file.

## Per-repo language hooks

Keep language/toolchain quality policy in repo-owned hook config or CI. The baseline's `python-bugs` check is not that: it is a fixed set of always-wrong-anywhere rules. Anything whose verdict depends on repo config -- `ruff check` with the project rule set, formatters, type checkers, `vulture`, `radon`, `import-linter` -- belongs to the repo. Use [`docs/PER_REPO_HOOKS.md`](docs/PER_REPO_HOOKS.md) for copy-paste examples that compose git-guardrails first, then run Python and TS/JS commands from the correct workspace root.

## Comparison

| Tool | Verb | What it writes | When it runs |
|---|---|---|---|
| **git-guardrails** | guard | user-owned hook shims in `.git/hooks` or pasteable compose snippets; uses shipped universal checks | commit-time + push-time + on-demand doctor/run |
| `pre-commit` | orchestrate | repo-owned `.pre-commit-config.yaml` plus installed hook entrypoints | commit-time; configured per repo |
| `lefthook` | orchestrate | repo-owned `lefthook.yml` commands and Git hook wiring | commit-time + push-time; configured per repo |
| `Husky` | wire | repo-owned `.husky/*` scripts, mostly for JS/package.json projects | commit-time + push-time; configured per repo |
| `Githooks` / `Overcommit` | manage | shared/repo hook runner config and hook entrypoints | Git hook time across configured hooks |
| `Gitleaks` | scan | findings only; optional config/rules | on-demand, CI, or when another hook runner invokes it |
| `TruffleHog` | verify secrets | findings only; broad source scanning, optional verification output | on-demand, CI, or when another hook runner invokes it |

More detail in [`docs/COMPARISON.md`](docs/COMPARISON.md).

## Security properties

- User-owned config lives outside repos.
- Uninstall removes only hooks with recognized ownership markers.
- Staged large-file checks inspect staged blobs, not mutable worktree bytes.
- Gitleaks uses the shipped baseline config explicitly, so repo-local `.gitleaks.toml` cannot weaken the scan.

## Development

```bash
bun test tests/git-guardrails.test.ts
bash -n git-guardrails checks/registry.sh
```
