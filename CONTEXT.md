# git-guardrails CONTEXT

Architecture context for agents (human and AI) working on git-guardrails itself.
For user documentation see `README.md`, `docs/*`, and `ROADMAP.md`.

## Load-bearing invariants

These do not change without a major version bump.

1. **User-owned safety layer**: repo contents must not be able to disable git-guardrails. Runtime opt-out is read from `~/.config/git-guardrails/.opt-out` (`GIT_GUARDRAILS_OPT_OUT`) in `_repo_is_opted_out` and `cmd_run`. There is deliberately no in-repo opt-out marker.
2. **Ownership-marker uninstall**: uninstall removes only hooks classified as ours. `_classify_hook` recognizes only the current marker `# git-guardrails-managed: git-guardrails.v0`; `cmd_uninstall` deletes only the `ours` state.
3. **Conflict-aware install**: `cmd_install` refuses unsafe local `core.hooksPath` overrides and non-owned hook files unless `--force` is explicit. Existing Husky, lefthook, pre-commit framework, and custom `.githooks/` surfaces are detected by `_detect_hook_systems` and receive compose guidance instead of silent clobbering.
4. **Classifier is the source of hook state truth**: `_classify_hook`, `_classify_repo_hooks`, and `_audit_repo` define absent / ours / non-ours / shadowed / opt-out. Install, uninstall, current-repo doctor, and `doctor --all` must route through those records instead of re-inferring hook state ad hoc.
5. **Compose snippets preserve Git hook semantics**: `_compose_snippet` owns embedded, standalone, and bypass-help hook text. Embedded snippets preserve `"$@"`, do not consume stdin, and exit non-zero when git-guardrails blocks. This is required for `commit-msg` file paths and `pre-push` ref streams.
6. **Curated checks registry**: `checks/registry.sh` is the shell-readable source of truth for shipped safety checks, skip env vars, required tools, optional tools, and rationale. README, `lefthook.yml`, doctor output, and tests should stay in parity with it. Admission to the baseline is decided by the **repo-independent verdict test** (ADR-008): a check qualifies only if it reaches the same conclusion in every repository without reading that repository's configuration. Repo-specific language/toolchain lint, format, typecheck, and test policy fails that test and belongs in repo-owned hook config or CI.
7. **Shipped security baselines beat repo-local weakening**: `cmd_run` invokes lefthook with the shipped `lefthook.yml`; the gitleaks check uses the shipped `gitleaks.toml`. A repo-local `.gitleaks.toml` must not weaken the baseline.
8. **Staged data, not mutable worktree data**: checks inspect staged blobs, not later worktree bytes. `checks/large-files.sh` uses `git cat-file -s :path`; `checks/python-bugs.sh` pipes `git cat-file blob :path` through `--stdin-filename`. Any new content-inspecting check must do the same.

## Module map

```
git-guardrails          bash CLI binary and dispatch
  constants/env            version, marker strings, template/config path resolution
  repo introspection       _repo_toplevel, _repo_hooks_dir, hooksPath helpers, opt-out
  classifier               _classify_hook, _classify_repo_hooks, _audit_repo
  compose snippets         _compose_snippet, _generate_shim
  commands                 cmd_install, cmd_uninstall, cmd_run, cmd_doctor,
                           cmd_doctor_all, cmd_global_template
checks/registry.sh         shell-readable curated check registry
checks/*.sh                concrete check implementations used by lefthook.yml
lefthook.yml               shipped hook orchestration config
commitlint.config.cjs      shipped Conventional Commits config
gitleaks.toml              shipped secret-scanning baseline
tests/git-guardrails.test.ts
                           Bun/TypeScript lifecycle + behavior tests over real temp repos
README.md                  user-facing install, commands, scope, comparison
ROADMAP.md                 architecture audit history and non-goals
CHANGELOG.md               release decisions and migration notes
docs/COMPARISON.md         detailed product landscape
```

The intended dependency shape is: commands render and mutate; classifier owns hook-state facts; registry owns check facts; lefthook executes checks. Avoid new code paths that read hook state or check metadata by hand when these seams already exist.

## Real seams

- **Hook-state classifier** (`_classify_hook`, `_classify_repo_hooks`, `_audit_repo`): real seam. Multiple commands consume the same state machine, and v0.4.0/v0.5.0 changelog entries show it removed drift between install, uninstall, and doctor.
- **Compose-snippet generator** (`_compose_snippet`): real seam. Installed hooks, conflict guidance, doctor bypass help, and README examples all need the same args/stdin/exit contract.
- **Curated-check registry** (`checks/registry.sh`): real seam. Doctor reachability, bypass hints, README check list, and lefthook parity tests all depend on the same check metadata.
- **Shipped config assets** (`lefthook.yml`, `gitleaks.toml`, `commitlint.config.cjs`): real adapter boundary between the bash CLI and external tools.

## Hypothetical seams (do not introduce yet)

- **Shared bash helper library across repos**: git-guardrails and git-wt both use TSV record streams, but no second concrete consumer needs the exact same helper API. Extracting a shared library would add release coupling before the interface is proven.
- **Plugin system or default language gates**: the curated safety baseline is the product. A plugin interface or built-in `ruff`/`biome`/`ty` defaults would move repo quality policy into git-guardrails and weaken the clarity of the baseline.
- **Hook-manager writers by default**: default install should remain user-owned `.git/hooks` plus conflict-aware refusal. Manager-specific mutation can exist only as an explicit feature with tests for Husky/lefthook/pre-commit surfaces.
- **Full Go rewrite**: Bash is still adequate for the current macOS/Homebrew personal CLI. Revisit only when shell quoting/TSV invariants or cross-platform distribution cost starts dominating feature work.

## TSV record convention

Classifier helpers (`_classify_hook`, `_classify_repo_hooks`, `_audit_repo`) emit
records as TSV. **Use a non-whitespace separator, never plain `\t`** — bash
`read -d $'\t'` collapses adjacent empty fields, which shifts column meaning.

The classifier uses `\x1f` (unit separator). Empty fields are preserved
because the separator is unambiguous. Consumers MUST use a matching IFS:

```bash
IFS=$'\x1f' read -r repo hooks_dir local_hooksPath_kind opt_out hook owner status
```

This is a load-bearing invariant. Earlier sessions hit production bugs from
`IFS=$'\t'` losing empty fields.

## Public API stability

There is no library API. The contract is the `git-guardrails` binary, generated hook marker/version, supported subcommands, skip/bypass environment variables, config locations, and shipped check behavior.

Breaking changes include changing marker semantics, changing config directory precedence, changing skip env names, changing hook names, or making previously accepted installs unsafe/refused without migration guidance.

## ADRs

ADR-001 — per-repo binary install over legacy global `core.hooksPath`: v0.3.0 replaced the old global-hooksPath directory with a real CLI binary and per-repo `git-guardrails install`. Decision: install ownership-marked hooks per repo and set local `core.hooksPath` so global hook setups such as wt do not shadow the baseline.

ADR-002 — marker-only uninstall: v0.3.0 introduced stable ownership markers and uninstall that removes only marked hooks. Decision: preserving non-owned hooks beats aggressive cleanup.

ADR-003 — classifier as hook-state source of truth: v0.4.0 centralized absent / ours / non-ours / shadowed / opt-out classification. Decision: commands consume classifier output instead of duplicating hook-state inference.

ADR-004 — doctor unification through structured records: v0.5.0 made `_audit_repo` emit one TSV record rendered by both `doctor` and `doctor --all`. Decision: current-repo and multi-repo audit must not drift.

ADR-005 — compose-snippet contract: v0.6.0 centralized embedded, standalone, and bypass-help snippets in `_compose_snippet`. Decision: every shim must preserve `"$@"`, respect stdin, and propagate blocking failures consistently.

ADR-006 — universals registry: v0.7.0 added `checks/registry.sh` as the source of truth for universal checks and tool reachability. Decision: adding/removing a check should be one registry edit plus parity updates, not scattered prose/code changes.

ADR-007 — product rename to git-guardrails: current rename changes the primary binary, marker, env vars, config dir, docs, tests, workflows, and formula references to `git-guardrails`. Decision: fresh installs use only `git-guardrails`.

ADR-008 — repo-independent verdict as the admission test: v0.9.1 moved `ruff`, `ty`, and `biome` out of the default baseline; this revision states the rule those removals were an instance of. Decision: a check belongs in the user-owned baseline only if its verdict is correct in every repository **without reading that repository's configuration**. Two failure modes motivate it. Honoring repo config hands a repo the power to disable a user-owned check from committed files, violating invariant 1 — measured: a file with an undefined name exits 1 under `ruff check --isolated`, and exits 0 when the repo's `pyproject.toml` sets `[tool.ruff.lint] ignore = ["F821"]`. Ignoring repo config while enforcing style imposes personal preference on other people's repos, producing routine false failures that train the user into `--no-verify`, which is not per-check and takes gitleaks down with it. Consequence: repo lint/format/typecheck rule sets, `vulture` (heuristic; needs a per-repo whitelist for dynamic dispatch), `radon` (threshold is a per-repo judgment), and `import-linter` (contracts are pure per-repo config) are permanently out. The tool is not the criterion.

ADR-009 — config-free bug gates are in: applying ADR-008's test admits `checks/python-bugs.sh` and retroactively justifies `fallow`. Decision: a fixed, non-extensible rule set of always-wrong-anywhere findings may ship in the baseline even when it is language-specific, provided it runs with repo config disabled (`--isolated`), reads staged blobs, and skips cleanly when its engine is absent. The rule set is fixed in the check script, not configurable, because a configurable rule set is repo policy wearing a baseline badge. Widening `RULES` in `python-bugs.sh` beyond runtime-bug rules reopens ADR-008.
