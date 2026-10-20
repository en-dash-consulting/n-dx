---
"@n-dx/lang-runtime": patch
"@n-dx/lang-sql": patch
"@n-dx/lang-terraform": patch
"@n-dx/sourcevision": patch
---

The SQL grammar, its table query and the schema reader move into `@n-dx/lang-sql`, and the HCL grammar pin and build into `@n-dx/lang-terraform` (structure only; it produces no fact kinds yet). Both packs are opt-in and not wired into analysis. `@n-dx/sourcevision` ships no grammar or query. `@n-dx/lang-runtime`'s `build-grammars.mjs` now requires `--out`: each pack builds its own grammar with its `build:grammars` script.
