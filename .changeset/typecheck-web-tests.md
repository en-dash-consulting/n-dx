---
"@n-dx/web": patch
---

Typecheck test files: `tsconfig.test.json` adds `tests/` to the program and `pnpm typecheck` now runs it, so test-only type errors (and syntax errors) fail the same gate as source instead of surfacing only at vitest transform time.
