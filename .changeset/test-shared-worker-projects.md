---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Test-only: each package's vitest config splits its files into a shared-worker project and an isolated one for files that mock modules or globals, through `tests/vitest-isolation.mjs`. Same tests, less per-file worker and module-graph cost. No production code changed.
