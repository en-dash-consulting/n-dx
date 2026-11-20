---
"@n-dx/graview": patch
"@n-dx/graview-face": patch
"@n-dx/hench": patch
"@n-dx/lang-go": patch
"@n-dx/lang-java": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/lang-python": patch
"@n-dx/lang-runtime": patch
"@n-dx/lang-sql": patch
"@n-dx/lang-terraform": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Test-only: every package suite can measure line, branch and function coverage with per-line hit counts, and fails below its recorded coverage floor.

`pnpm test:coverage` runs each package's new `test:coverage` script, which writes HTML, lcov and JSON reports to `packages/<pkg>/coverage/`. `pnpm coverage:lines <pkg>` prints how many times the suite executed each line. Shared settings live in `tests/vitest-coverage.mjs`; see TESTING.md, "Code Coverage".
