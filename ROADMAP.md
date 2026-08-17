# gg Roadmap

> **v1.0.0 replaced the repository hook layer with an advisory, user-invoked reviewer.** Milestones below that predate v1.0.0 are retained as historical context, not as descriptions of the current product.
>
> Current architecture and next deepening opportunities follow. Load-bearing invariants live in `CONTEXT.md`; release history lives in `CHANGELOG.md`.

## Current state (v1.0.0)

`gg` is a single-file Bash CLI with a small set of check adapters:

- `gg` - CLI dispatch, Git scope resolution, check discovery, file filtering, execution, and presentation
- `checks/*.sh` - self-describing advisory checks and the two guard-compatible security checks
- `install.sh` - user-level checkout and executable-link installer
- `tests/gg.test.ts` - CLI, protocol, check, repository, and installer tests

The product boundary is an on-demand personal code review. Repository-owned lint, format, typecheck, test, and configuration policy remain the repository's responsibility. Normal reviews report findings and check errors but exit successfully; only the narrow `gg guard pre-push` publication guard can block.

## Architecture already delivered

The v0.x milestones in this section describe the retired hook-layer product. They remain here only to record the decisions that led to v1.0.0.

### v0.4.0 - Hook-state classifier (historical)

- Centralized classification of hook ownership and conflicts.
- Routed repository setup, removal, and audit behavior through stable state words.
- Added coverage for absent, owned, conflicting, opted-out, and shadowed states.

### v0.5.0 - Audit unification and lifecycle coverage (historical)

- Made one repository audit record serve both single-repository and multi-repository views.
- Added lifecycle coverage for setup, removal, forced replacement, skipped hooks, audit agreement, and global template generation.

### v0.6.0 - Compose-shim contract (historical)

- Centralized embedded, standalone, and bypass-help snippets.
- Preserved arguments, standard input, and blocking exit behavior across generated hook shims.
- Added adapter tests for argument forwarding, pre-push input, and non-zero propagation.

### v0.7.0 - Universal checks registry (historical)

- Added a central source for shipped check metadata.
- Used registry entries for tool reachability and bypass guidance.
- Added parity tests for registry shape, skip controls, and tool reporting.

### v0.9.x - Clean product boundary (historical)

- Completed the `git-guardrails` naming cutover for the former product.
- Removed language-specific quality gates from its blocking baseline.
- Separated repository-owned language checks from the shipped safety baseline.
- Established a single skip control for all checks.

### v1.0.0 - Advisory reviewer

- Replaced automatic per-repository hooks with the user-invoked `gg` command.
- Made checks executable adapters that declare their scope with `# gg-globs:`.
- Centralized scope resolution, check discovery, filtering, execution, and presentation in `gg`.
- Added heuristic Python, JavaScript, complexity, architecture, dead-code, secret, and large-file reviews without authoring repository configuration.
- Retained only a narrow, explicitly invoked pre-push guard for secrets and large files.

## Current target

### Domain layer

```text
resolve review mode and base -> repository-relative candidate files
read each check's gg-globs header -> matching changed files
run check with GG_ROOT, GG_INVOKE_DIR, GG_BASE, GG_RANGE, GG_LOCAL_REF, GG_FILES, GG_MODE
classify exit 0 as ran, 2 as unavailable, and all others as errors
```

### Adapter layer

- Each executable `checks/*.sh` owns one tool integration.
- Each check declares accepted files in a `# gg-globs:` header.
- Checks emit only finding records or one runner-unavailable reason.
- Tool-specific execution and output normalization stay inside the corresponding check.
- Checks may honor repository configuration that already exists but never create it.

### CLI layer

`gg` owns command dispatch, Git scope and base resolution, check discovery, glob filtering, environment construction, execution, grouped presentation, skipped and error status, and the final summary.

## Next deepening candidates

### 1. Protocol parsing locality

**Problem**: Header parsing, glob matching, and exit classification form the check protocol and must remain consistent as checks are added.

**Direction**: Keep these rules in small private helpers inside `gg`. Do not introduce a plugin framework or a second manifest.

**Acceptance**:

- A malformed or missing `# gg-globs:` header produces one clear check error.
- Exit `0`, exit `2`, and unexpected failures retain distinct presentation.
- Protocol tests exercise actual executable check fixtures.

### 2. Scope resolution clarity

**Problem**: Branch, staged, path, and explicit-range modes share file handling but differ in how Git supplies candidates and content.

**Direction**: Keep mode selection and base resolution explicit, then converge on one repository-relative file-list path before check filtering.

**Acceptance**:

- Each public review mode has fixture coverage in a real temporary repository.
- Deleted files, renamed files, spaces in paths, and an unborn branch have intentional behavior.
- Base-resolution fallbacks are reported clearly and tested independently of check output.

### 3. Check adapter consistency

**Problem**: External runners expose different command lines, configuration behavior, output formats, and missing-tool failures.

**Direction**: Keep one small shell adapter per tool and normalize only at that boundary. Share code only after a second concrete adapter needs the same behavior.

**Acceptance**:

- Every adapter emits the documented finding syntax.
- Missing runners exit `2` with one short reason.
- Runner errors cannot be mistaken for findings.
- Checks do not create or recommend repository configuration.

### 4. Documentation routing

**Problem**: Architecture facts span `CONTEXT.md`, `ROADMAP.md`, README, and the changelog. Drift can mislead future contributors.

**Direction**: Keep invariants and ADRs in `CONTEXT.md`, release history in `CHANGELOG.md`, the user contract in README, and current target shape plus future candidates here.

**Acceptance**:

- No stale version-labeled current-state sections.
- No completed milestone is listed as future work.
- Architecture candidates cite current files and public command names.

## Non-goals

- No repository-specific lint, format, typecheck, test, or generated configuration.
- No general plugin framework; executable checks are the complete extension seam.
- No server-side enforcement or mandatory local review.
- No shared shell helper library until a second concrete consumer needs the same API.

## Open questions

- Which additional findings are sufficiently actionable and configuration-free for the advisory roster?
- Should the narrow publication guard remain a subcommand of `gg` if its protocol stops sharing code with advisory review?
