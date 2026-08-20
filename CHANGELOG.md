# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `anti-slop` review check: runs the generic [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) Oxlint rules over changed `*.ts`/`*.tsx`/`*.js`/`*.jsx`/`*.mjs`/`*.cjs` files to surface low-evidence patterns (unparsed `unknown`/`object` inputs, chained or undocumented type assertions, `unknown`-valued dictionaries, module mocks). The rule set is fixed and the repository's own Oxlint config is ignored (`--config` + `--disable-nested-config` + `--allow all`, builtin plugins off), so the verdict is repo-independent per ADR-008/ADR-009 (ADR-011). The rules are vendored under `checks/anti-slop/plugin`; their one runtime dependency (`@oxlint/plugins`) is installed lazily inside gg's own checkout on first JS/TS review and the check skips cleanly (exit 2) when `npm` is unavailable. The Effect rule group is intentionally excluded. Oxlint is pinned via `ANTI_SLOP_OXLINT_VERSION` (default `1.78.0`).

## [1.0.0]

### Changed

- Replaced the blocking, per-repository Git hook layer with `gg`, an advisory reviewer run on demand against the current branch, staged changes, or selected paths.
- Expanded the review roster to include isolated Python bug checks, whole-repository Vulture analysis filtered to changed files, Radon complexity regressions, existing import-linter contracts, diff-aware Fallow analysis, and Gitleaks.
- Retained one intentionally blocking path: `gg guard pre-push` runs only secrets and large-file checks from the user's own global hook chain because a push publishes credentials and history.
- Distribution now uses `curl -fsSL https://raw.githubusercontent.com/noamsiegel/gg/main/install.sh | bash`, installs under `~/.local/share/gg`, links `~/.local/bin/gg`, and updates with `gg self-update`.

### Breaking

- `git-guardrails install`, `uninstall`, `doctor`, and `migrate`, the Homebrew formula, and all per-repository hook management are gone.
- `gg` does not install into repositories, author per-repository configuration, or change `core.hooksPath`. Normal reviews always exit `0`; only `gg guard pre-push` can block.

## [v0.10.0]

### Added
- `python-bugs` pre-commit check: a fixed, non-configurable Ruff rule set (`F821`, `F822`, `E902`) run with `--isolated` over staged blobs. Flags Python that is broken in any repository without reading or enforcing that repository's lint config. Host-injected globals (`get_ipython`, `tags`, `display`) are declared inline so Sphinx `conf.py` and IPython startup files do not false-positive; `F811` and `F823` are excluded because decorator-registered handlers legitimately reuse names. Skips cleanly when `uvx` is absent; bypass with `SKIP_PYTHON_BUGS=1`, pin with `RUFF_VERSION`.

### Changed
- ADR-008 restated as the general admission test for the baseline: a check ships only if its verdict is correct in every repository without reading that repository's configuration. The v0.9.1 `ruff`/`ty`/`biome` removals were an instance of this rule, not the rule itself. `vulture`, `radon`, and `import-linter` are documented as permanently out under the same test.
- ADR-009 added: config-free bug gates may be language-specific, which is what justifies `fallow` and `python-bugs` remaining in a baseline that excludes language lint.

### Fixed
- Template resolution now prefers the running binary's sibling `share/git-guardrails` over the hardcoded `/opt/homebrew` and `/usr/local` prefixes. A binary run from any other prefix previously executed the Homebrew copy's `lefthook.yml` and `checks/`, so a check that existed only in the running prefix silently never ran and the commit succeeded as if it had passed.

## [v0.9.2]

### Changed
- Renamed the all-check bypass environment variable from `SKIP_PERSONAL_HOOKS` to `GIT_GUARDRAILS_SKIP` to match the clean `git-guardrails` public API.

### Fixed
- `doctor --all` bypass guidance now emits the blocking compose snippet instead of advisory bypass-help text.

### Documentation
- Refreshed `ROADMAP.md` so future architecture work starts from the current v0.9.x state instead of completed v0.4-v0.7 milestones.

## [v0.9.1]

### Changed
- Moved Python and TS/JS language gates out of the default git-guardrails baseline. `ruff`, `ty`, and `biome` are now documented as repo-owned hook/CI policy instead of user-owned safety checks.

### Removed
- Clean cutover to `git-guardrails` only: removed the `ai-git-guardrails` wrapper, old-name marker/env/config/template compatibility, stale legacy shim migration, and active migration docs/tests.
- Removed shipped `checks/ruff.sh`, `checks/ty.sh`, and `checks/biome.sh` wrappers so repositories invoke their own language commands directly.

## [0.9.0] — git-guardrails rename

### Changed
- Primary product name, binary, generated hook marker, env vars, config dir, docs, tests, workflow smoke checks, and Homebrew formula references now use `git-guardrails`.
- Product scope remains universal-only: per-repo install is primary, global template is optional, and GitHub Actions feature work remains out of scope.

### Migration
- Legacy `ai-git-guardrails` entrypoint remains as a forwarding wrapper to `git-guardrails` for old hooks/installations where both files ship together.
- Existing `# ai-git-guardrails-managed: ai-git-guardrails.v0` hooks, older `# guardrails-managed: guardrails.v0` hooks, `AI_GIT_GUARDRAILS_*` / `GUARDRAILS_*` env vars, and `~/.config/ai-git-guardrails/` / `~/.config/guardrails/` dirs remain recognized during migration.

## [0.8.3] — legacy shim auto-migration

### Fixed
- `install` now detects stale v0.7-era hook shims with `# guardrails-managed:` markers that still invoke the old `guardrails` binary, rewrites them to canonical `git-guardrails` standalone shims, and reports migrated hook count in the install summary.
- `run` and `doctor` now warn once per invocation when a repo still has a stale legacy shim, pointing users to `git-guardrails install --force` for migration.

## [0.8.2] — TSV separator hotfix + RELEASING.md

### Fixed
- Classifier record stream (`_classify_repo_hooks`, `_audit_repo`, `doctor`, `doctor --all`) was emitting plain-tab-separated records despite docs documenting `\x1f` (unit separator). Empty fields would silently shift columns under `IFS=$'\t'`. Migrated producer and all consumers to `GIT_GUARDRAILS_RECORD_SEP=$'\x1f'` so empty fields are preserved.

### Added
- `RELEASING.md`: copy-pasteable release checklist + recovery notes (stale shim, tag misalignment).
- `CONTEXT.md`: TSV record convention section citing the specific helpers and the `IFS` failure mode it prevents.

## [0.8.1] — doctor path + opt-out hotfix + architecture docs

### Added
- `CONTEXT.md` with load-bearing invariants, module map, real vs hypothetical seams, public CLI stability, and ADRs.
- `AGENTS.md` orienting agents working on this repo itself.
- `docs/COMPARISON.md` with full narrative competitor analysis (pre-commit, lefthook, Husky, Githooks, Overcommit, Gitleaks, TruffleHog).

### Changed
- `README.md` competitor section reformatted to the agents-toc-style table (`Tool | Verb | What it writes | When it runs`) and links to the new comparison doc.
- Added explicit `## What it doesn’t do` section.

### Fixed
- `_find_git_repos` now uses null-delimited `find` output so `doctor --all` preserves repo paths containing spaces instead of splitting them around line 645.
- `cmd_run` now calls `_repo_is_opted_out` around line 420, preserving canonical-path opt-out behavior for symlinked or otherwise non-canonical repo paths.

## [0.8.0] — git-guardrails rename

### Breaking
- CLI binary is now `git-guardrails`; generated hooks now call `git-guardrails run <hook>`.
- Fresh installs use marker `# git-guardrails-managed: git-guardrails.v0`, config dir `~/.config/git-guardrails/`, and `GIT_GUARDRAILS_*` env vars.

### Changed
- Renamed in-repo source, tests, docs, workflow references, lefthook defaults, and registry variables from the old name to `git-guardrails`.
- `checks/registry.sh` now exports `GIT_GUARDRAILS_CHECKS`, `GIT_GUARDRAILS_REQUIRED_TOOLS`, and `GIT_GUARDRAILS_OPTIONAL_TOOLS`.

### Migration
- Existing hooks with legacy marker `# guardrails-managed: guardrails.v0` are still classified as ours, so `git-guardrails uninstall` can remove old installs safely instead of reporting non-ours conflicts.
- `GUARDRAILS_TEMPLATES` and `GUARDRAILS_PATH` remain backward-compatible fallbacks when the new `GIT_GUARDRAILS_*` env vars are absent.
- If `~/.config/guardrails/` exists and `~/.config/git-guardrails/` does not, the CLI reads the old config dir and warns to move it.

## [0.7.0] — universals registry

### Added
- `checks/registry.sh` is the shell-readable source of truth for universal checks, skip env vars, required tools, optional tools, and rationale.
- Registry tests cover loadability, field shape, lefthook skip-env cross-checks, required tool reachability, and doctor reachability output parity.

### Changed
- `guardrails doctor` builds tool reachability from the registry instead of a hardcoded list.
- `_compose_snippet <hook> bypass-help` builds per-check skip-env hints from the registry.
- `lefthook.yml` and README now cross-reference the registry-backed universal check list.

## [0.6.0] — compose-shim contract

### Added
- `_compose_snippet <hook> <mode>` centralizes embedded, standalone, and bypass-help hook snippets.
- Compose-snippet tests cover argument forwarding, pre-push stdin preservation, exit-code propagation, bypass-help shell syntax, and invalid modes.

### Changed
- Installed hooks, install conflict guidance, doctor bypass guidance, and README examples now share the same canonical compose contract.

## [0.5.0] — doctor unification + lifecycle coverage

### Added
- `_audit_repo` now emits one structured TSV record consumed by both current-repo `doctor` and `doctor --all`.
- Lifecycle tests cover install, uninstall, force install, skipped hooks, migration dry-run/apply, doctor detail/summary agreement, and global template generation.

### Changed
- `doctor --all` uses the same classifier-derived categories as `doctor`: installed, not-installed, bypass-other, and opt-out.
- `guardrails install` always sets local `core.hooksPath` to the repo hooks directory it manages.
- Branch guard, large-file, and commitlint checks are table-driven where behavior was redundant.

## [0.4.0] — stale-ref cleanup + hook classifier

### Added
- `_classify_hook` and `_classify_repo_hooks` centralize hook ownership state for install, uninstall, and doctor audit flows.
- Classifier coverage for absent, guardrails-owned, non-guardrails, opt-out, and hooksPath-shadowed hooks.

### Changed
- `lefthook.yml` now resolves shipped assets through `${GUARDRAILS_TEMPLATES:-$HOME/.config/guardrails/templates}` instead of the legacy personal-hooks path.
- Tests now exercise `guardrails doctor --all --root <tmpdir>` directly for worktree detection and use hermetic XDG config directories.
## [0.3.4] — hotfix: trap unbound-variable in pre-push

### Fixed
- `cmd_run pre-push` set `trap 'rm -f $tmp' EXIT` with single quotes, deferring expansion. When the trap fired (after the function returned), `$tmp` was out of scope and `set -u` aborted with "tmp: unbound variable". Now double-quoted to expand at trap-set time.

## [0.3.3] — guardrails doctor --all (multi-repo audit)

### Added
- `guardrails doctor --all [--root <path>]` walks a root and reports per-repo install state (installed / not-installed / bypass / opt-out) with a suggested fix for bypass repos.
- `pai-hooks doctor` is now a deprecation shim that forwards to `guardrails doctor --all`.

## [0.3.2] — version-sync hotfix

Bump GUARDRAILS_VERSION constant to match tag (was stuck at 0.3.0).

## [0.3.1] — stale state cleanup

### Removed
- Obsolete v0.2.x entry shim files: `pre-commit`, `pre-push`, `commit-msg` (replaced by the `guardrails` binary).
- `package.json` + `bun.lock` (no longer needed; the binary ships its own commitlint config from `pkgshare`).
- `skill/` subdirectory (the multi-repo audit skill lives in `~/.pai/skills/guardrails/` on the user's machine, not in the public repo).

### Changed
- README rewritten to reflect the binary install model (per-repo `guardrails install` only).

## [0.3.0] — real CLI binary (per-repo install, ownership marker)

### Breaking
- guardrails is now a proper CLI binary, not a directory you point `core.hooksPath` at.
- The previous global-hooksPath install model is replaced by per-repo `guardrails install`.

### Added
- **`guardrails install`** — installs hooks into the current repo's `.git/hooks/` with ownership marker. Sets local `core.hooksPath` to override any global setting (e.g. wt). Detects existing hook systems (Husky, lefthook, pre-commit framework, custom `.githooks/`) and prints a one-line compose snippet instead of clobbering.
- **`guardrails uninstall`** — removes only guardrails-managed hooks (marker-based). Restores `core.hooksPath` to global default if no other hooks remain.
- **`guardrails run <hook>`** — the actual hook logic, invoked by installed shims. Delegates to `lefthook run` with shipped config.
- **`guardrails doctor`** — audits the current repo + tool reachability under sanitized PATH.
- **`guardrails migrate [--apply]`** — migrates from legacy global-hooksPath install. Defaults to dry-run; `--apply` performs the migration.
- **`guardrails --global-template`** — wires `git init.templateDir` so new clones auto-install guardrails hooks.
- **`--force` flag** on install to override conflicts.
- **`--skip <hook>` flag** to install a subset.

### Security
- Generated hooks contain a stable ownership marker (`# guardrails-managed: guardrails.v0`).
- Install uses `rm -f` before write to prevent symlink-target overwrites (a destructive pattern from the legacy install model).
- `core.hooksPath`-conflict detection refuses install by default with a useful error.

## [0.2.0] — integration + portability + governance

### Added
- XDG `init.sh` support in entry shims (asdf/mise/nvm/volta compatibility).
- `branch-guard` reads `protected_refs` from wt config when running inside a wt-managed repo.
- OSS governance: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, ISSUE_TEMPLATE, PR template, CODEOWNERS.
- Release CI workflows (test on PR + workflow_dispatch semver release).

## [0.1.0] — initial public release

### Added
- Universal `pre-commit` checks: gitleaks, actionlint (on workflow files), large-files (staged-blob).
- `commit-msg`: commitlint with Conventional Commits.
- `pre-push` checks: branch-guard (list or regex), fallow audit (JS/TS only).
- Portable lefthook config that consumers can `extends:` via `GUARDRAILS_HOME` env var.
- `pai-hooks doctor` skill (Bun/TS) audits coverage across all local repos.
- 22-test bun-test suite.

### Security hardening (vs naive lefthook setups)
- User-owned gitleaks baseline that defeats hostile repo `.gitleaks.toml`.
- `git cat-file -s` staged-blob check (no worktree-truncation bypass).
- No in-repo opt-out marker — repos cannot disable user-level checks.
- PATH sanitization at hook entry; override via `GUARDRAILS_PATH`.
- Env-var bypass requires explicit `SKIP_*` per check (not ambient state).

### Known limitations
- macOS-tested. Linux probably works but untested in CI.
- bash >= 4 required.
- `commitlint` requires `@commitlint/config-conventional` resolvable from the lefthook config. Local install via `bun install` in this directory creates `node_modules/` for that.
