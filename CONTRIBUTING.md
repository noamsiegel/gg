# Contributing to gg

Thanks for improving `gg`. This repository provides a portable, advisory code reviewer. Keep changes explicit, hostile-repository-aware, and free of repository-specific policy.

## How to report a bug

Open a [bug report](./.github/ISSUE_TEMPLATE/bug.md) with reproduction steps, expected behavior, actual behavior, and environment details.

## How to propose a feature

Open a [feature request](./.github/ISSUE_TEMPLATE/feature.md) with the problem, proposed solution, and alternatives considered.

## Development setup

Clone the repository, enter the checkout, and run `gg` directly:

```bash
git clone https://github.com/noamsiegel/gg.git
cd gg
./gg
```

The checks use tools already present on `PATH`. Depending on the files under review, they may use `uvx`, `npx`, or `gitleaks`. A missing runner skips its check instead of failing the review.

## Running tests

Run the CLI test suite:

```bash
bun test tests/gg.test.ts
```

For shell changes, also check syntax:

```bash
bash -n gg
bash -n install.sh
for f in checks/*.sh; do bash -n "$f"; done
```

## Adding a check

Add an executable `checks/<name>.sh` file with a `# gg-globs:` header declaring the files it accepts:

```bash
#!/usr/bin/env bash
# gg-globs: *.py *.pyi
```

The core filters changed files before invoking the check. Checks must follow this protocol:

- Exit `0` when the check ran, whether or not it found issues.
- Exit `2` when the required runner is unavailable, and print one short reason.
- Use any other exit code for an execution error.
- Print findings one per line as `path:line: message`, or `path: message` when no line is available.
- Do not print headings, summaries, banners, or blank lines. The core owns presentation.
- Never author per-repository configuration. A check may honor configuration the repository already owns.

## Commit message format

Conventional Commits are recommended but not required:

```text
fix: preserve filenames containing spaces
feat: add a config-free Ruby bug check
```

## Pull request checklist

- [ ] Tests pass with `bun test tests/gg.test.ts`.
- [ ] Changed shell scripts pass `bash -n`.
- [ ] Documentation reflects user-visible changes.
- [ ] `CHANGELOG.md` records user-visible changes.
