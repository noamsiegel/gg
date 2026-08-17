# gg CONTEXT

Architecture context for people and agents working on `gg`. For the user-facing contract, see `README.md`.

## Load-bearing invariants

1. **No repository footprint**: `gg` reads the repository under review but never installs files into it, changes Git configuration, or authors repository configuration.
2. **Advisory reviews exit successfully**: normal `gg` review commands always exit `0`. Findings and check errors are report content, not gates. Only `gg guard pre-push` is blocking.
3. **Checks self-describe their scope**: every executable `checks/*.sh` has one `# gg-globs:` header. The core owns discovery and filters `GG_FILES` before invocation.
4. **Presentation has one owner**: checks print finding records or one skip reason. Headers, grouping, errors, skipped status, and the final summary live only in the core CLI.
5. **No per-repository configuration authorship**: checks either need no configuration or honor a contracts file the repository already owns. `gg` never creates, edits, or recommends generated repository configuration.
6. **Run scope may differ from report scope**: `dead-code` runs Vulture over the whole repository because whole-program context prevents invented dead-code findings, then filters its report to changed files. Do not optimize this into a changed-files-only run.
7. **Publication guard stays narrow**: the user's own global pre-push chain may invoke `gg guard pre-push`, which runs only secrets and large-files over the push range.

## Module map

| Path | Responsibility |
|---|---|
| `gg` | CLI dispatch, Git mode and range resolution, check discovery, glob filtering, execution, and all presentation |
| `checks/*.sh` | One tool adapter per advisory check, plus the guard-compatible security checks |
| `install.sh` | User-level clone/update and executable symlink; no repository or Git configuration changes |
| `tests/*` | CLI, protocol, check, and real-repository behavior coverage |
| `README.md` | User-facing installation, commands, roster, protocol, and boundaries |
| `CONTEXT.md` | Invariants, architecture map, and decision history |
| `CHANGELOG.md` | Release history and breaking changes |

The dependency direction is deliberately flat: `gg` discovers and invokes independent executable checks. Checks do not call one another and do not own presentation. There is no registry, plugin framework, hook-state model, or repository installer.

## Public contract

There is no library API. The public contract is the `gg` command surface, the check environment and exit protocol, finding syntax, advisory exit behavior, the user-level installation paths, and the narrow blocking behavior of `gg guard pre-push`.

## ADRs

ADR-001 — per-repo binary install over legacy global `core.hooksPath`: v0.3.0 replaced the old global-hooksPath directory with a real CLI binary and per-repo `git-guardrails install`. Decision: install ownership-marked hooks per repo and set local `core.hooksPath` so global hook setups such as wt do not shadow the baseline.

ADR-002 — marker-only uninstall: v0.3.0 introduced stable ownership markers and uninstall that removes only marked hooks. Decision: preserving non-owned hooks beats aggressive cleanup.

ADR-003 — classifier as hook-state source of truth: v0.4.0 centralized absent / ours / non-ours / shadowed / opt-out classification. Decision: commands consume classifier output instead of duplicating hook-state inference.

ADR-004 — doctor unification through structured records: v0.5.0 made `_audit_repo` emit one TSV record rendered by both `doctor` and `doctor --all`. Decision: current-repo and multi-repo audit must not drift.

ADR-005 — compose-snippet contract: v0.6.0 centralized embedded, standalone, and bypass-help snippets in `_compose_snippet`. Decision: every shim must preserve `"$@"`, respect stdin, and propagate blocking failures consistently.

ADR-006 — universals registry: v0.7.0 added `checks/registry.sh` as the source of truth for universal checks and tool reachability. Decision: adding/removing a check should be one registry edit plus parity updates, not scattered prose/code changes.

ADR-007 — product rename to git-guardrails: current rename changes the primary binary, marker, env vars, config dir, docs, tests, workflows, and formula references to `git-guardrails`. Decision: fresh installs use only `git-guardrails`.

ADR-008 — superseded by ADR-010 — repo-independent verdict as the admission test: v0.9.1 moved `ruff`, `ty`, and `biome` out of the default baseline; this revision states the rule those removals were an instance of. Decision: a check belongs in the user-owned baseline only if its verdict is correct in every repository **without reading that repository's configuration**. Two failure modes motivate it. Honoring repo config hands a repo the power to disable a user-owned check from committed files, violating invariant 1 — measured: a file with an undefined name exits 1 under `ruff check --isolated`, and exits 0 when the repo's `pyproject.toml` sets `[tool.ruff.lint] ignore = ["F821"]`. Ignoring repo config while enforcing style imposes personal preference on other people's repos, producing routine false failures that train the user into `--no-verify`, which is not per-check and takes gitleaks down with it. Consequence: repo lint/format/typecheck rule sets, `vulture` (heuristic; needs a per-repo whitelist for dynamic dispatch), `radon` (threshold is a per-repo judgment), and `import-linter` (contracts are pure per-repo config) are permanently out. The tool is not the criterion.

ADR-009 — config-free bug gates are in: applying ADR-008's test admits `checks/python-bugs.sh` and retroactively justifies `fallow`. Decision: a fixed, non-extensible rule set of always-wrong-anywhere findings may ship in the baseline even when it is language-specific, provided it runs with repo config disabled (`--isolated`), reads staged blobs, skips index entries that are not regular files, and skips cleanly when its engine is absent. The rule set is fixed in the check script, not configurable, because a configurable rule set is repo policy wearing a baseline badge. Two consequences found in review: a rule that fires on working code fails ADR-008 even though it looks like a bug rule (`F811` flags two `@app.route` handlers sharing a name; the first is already registered, so the program works), and host-injected globals must be declared in the check (`get_ipython`, `tags`, `display`) rather than discovered from the repo, otherwise Sphinx `conf.py` and IPython startup files false-positive. Widening `RULES` in `python-bugs.sh` beyond runtime-bug rules reopens ADR-008.

ADR-010 — advisory reviewer supersedes blocking hook layer: ADR-008 required a repo-independent verdict because checks blocked work and ran without the repository's consent. A wrong verdict in one repository trained the user to reach for `--no-verify`; that bypass is not per-check, so it also takes Gitleaks down with the mistaken check. Once the tool is advisory and nonblocking, a false positive costs seconds of reading instead of a broken commit. The correctness bar that excluded Vulture because it is heuristic, Radon because complexity thresholds are per-repository judgments, and import-linter because contracts are per-repository configuration no longer applies. All three are now in the roster.

The boundary against repository-configured lint survives for a different reason: non-duplication. Repository CI already owns `ruff check`, `tsc`, `eslint`, formatting, type checking, and project-specific commands. Running them in `gg` would rebuild the per-repository configuration hell that ADR-008 deleted. `gg` may honor an import-linter contracts file the repository already owns, but it never authors one.

The tradeoff is explicit: the user gives up the guarantee that these checks cannot be skipped, in exchange for zero per-repository footprint. One exception remains. Secrets and large files still block at pre-push through the user's own global hook chain because a local commit is recoverable while a push publishes credentials or oversized history. Nothing else blocks: heuristic quality findings do not justify preventing publication.
