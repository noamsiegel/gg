# AGENTS.md

This file orients agents working on **gg** itself. Read `CONTEXT.md` for the load-bearing invariants and architecture decisions. See `README.md` for the user-facing surface.

## How to work here

- **This repo direct-main. Never open pull request.**
- Verification local: install checkout into scratch prefix (`bin/` plus sibling `share/git-guardrails/`) drive real `git commit`, because `bun test` alone not exercise shim, Homebrew binary on `PATH` whatever version was last released.
- Put orchestration, file selection, Git range handling, result classification, and all presentation in the `gg` core executable.
- Put one review implementation in each executable `checks/*.sh` file. Do not add a registry or a second presentation path.
- Never author or modify per-repository configuration. Checks either need no configuration or honor a contracts file the repository already owns.
- Dogfood `agents-trace`: since changes land directly on `main` without a PR, after push run `agents-trace gist-create` and `agents-trace collect` for local audit evidence. `agents-trace pr-attach` does not apply to this repository.

## Check contract

Each check declares its file globs in one header line:

```bash
# gg-globs: *.py *.pyi
```

The core invokes a check only when at least one changed file matches. It provides `GG_ROOT`, `GG_INVOKE_DIR`, `GG_BASE`, `GG_RANGE`, `GG_LOCAL_REF`, `GG_FILES`, and `GG_MODE` as documented in `README.md`.

Checks emit only findings in `path:line: message` or `path: message` form. They must not print headings, banners, summaries, or blank lines. Exit `0` means the check ran, including when findings exist. Exit `2` means a required runner is unavailable and must include one short reason on stdout. Any other exit means the check itself errored.

Normal `gg` review is advisory and always exits `0`. Only `gg guard pre-push` is blocking, and it is limited to secrets and large files.

## Documentation index

- `README.md` - installation, commands, roster, check protocol, and boundaries.
- `CONTEXT.md` - architecture, invariants, module map, and ADRs.
- `CHANGELOG.md` - release history and breaking changes.
- `CONTRIBUTING.md` - contribution workflow.
- `SECURITY.md` - vulnerability reporting.
