---
"@n-dx/lang-runtime": patch
---

The grammar build survives packs building at once over its shared toolchain cache: each build extracts its own copy of a toolchain archive into a directory of its own and renames it into place, uses a copy another build verified meanwhile instead of replacing it, and writes downloads under a temporary name before renaming them. The missing-grammar hint names `pnpm -r --workspace-concurrency=1 run build:grammars`.
