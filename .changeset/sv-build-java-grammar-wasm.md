---
"@n-dx/sourcevision": patch
---

Build the tree-sitter Java grammar to WASM from a pinned release.

`pnpm --filter @n-dx/sourcevision build:grammars` downloads tree-sitter-java
0.23.5 and the tree-sitter 0.27.0 CLI binary, checks each against a SHA-256
pinned in `scripts/build-grammars.mjs`, and writes
`build/grammars/tree-sitter-java.wasm` (gitignored). The wasi-sdk 34.0 and
binaryen 132 toolchains the CLI compiles with are fetched the same way, each
checked against a per-platform SHA-256 and handed to the CLI through
`TREE_SITTER_WASI_SDK_PATH` and `TREE_SITTER_BINARYEN_PATH`, so the CLI
downloads nothing unverified. No Docker, emscripten or native compiler is
needed.
`web-tree-sitter` 0.27.0 is added as an exact-pinned dependency; no native
addon is added. Nothing in analysis uses the grammar yet.
