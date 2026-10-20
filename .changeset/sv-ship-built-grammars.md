---
"@n-dx/sourcevision": patch
---

Ship built tree-sitter grammars in the published package.

`@n-dx/sourcevision` now includes `build/grammars/*.wasm`, built by the
release workflow, so an npm install gets structure mode for Java instead of
inventory-only. When a grammar is missing, the notice names a step the reader
can run: `pnpm --filter @n-dx/sourcevision build:grammars` in a source
checkout, or reinstalling n-dx for a published install.
