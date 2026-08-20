# Vendored anti-slop

`plugin/` is a vendored copy of the generic rules from
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (MIT). anti-slop is
designed to be vendored and edited, not pinned as a dependency, so this is the
intended distribution model.

- Source: `src/` of anti-slop, minus `*.test.ts` (gg does not run the upstream
  test suite; the rules' behavior is gg's contract, exercised by `tests/`).
- Oxlint / `@oxlint/plugins` version: `1.78.0`, pinned in two places that MUST
  stay equal: `ANTI_SLOP_OXLINT_VERSION` in `../anti-slop.sh` and the
  `@oxlint/plugins` dependency in `plugin/package.json`.

To update: re-copy `src/` from the upstream tag, delete `*.test.ts`, bump both
pinned versions together, and reinstall (`rm -rf plugin/node_modules
plugin/.deps-installed`; the next `gg` run reinstalls).

The Effect rule group is deliberately not vendored: it encodes Effect
architecture policy and would misfire in non-Effect repositories.
