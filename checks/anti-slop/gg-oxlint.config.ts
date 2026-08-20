// gg-owned Oxlint config for the vendored anti-slop plugin.
//
// This file is gg's, not the repository's. gg never authors or reads the
// repository's own Oxlint config (invariant 5, ADR-008: a user-owned check
// must produce the same verdict in every repository without reading that
// repository's configuration). The anti-slop check invokes oxlint with
// `-c <this file> --disable-nested-config -A all` plus the builtin plugins
// disabled, so the repository under review cannot enable, disable, or reshape
// what fires here.
//
// Exported as a plain object rather than via oxlint's `defineConfig` so the
// config loads without `oxlint` being resolvable next to it; only the vendored
// `@oxlint/plugins` dependency needs to be installed (see ./plugin/package.json).
//
// Effect rules are intentionally omitted: they encode Effect architecture
// policy and would be noise in non-Effect repositories, which fails the
// repo-independent-verdict test above.
const dir = import.meta.dirname;

export default {
  jsPlugins: [{ name: "anti-slop", specifier: `${dir}/plugin/index.ts` }],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
};
