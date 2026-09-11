---
"@n-dx/rex": patch
---

Extract the CLI's `resolveDir()` (last positional argument, or `process.cwd()`) into its own module (`src/cli/resolve-dir.ts`) so the cwd-relative contract behind `rex mcp .` — and every other `rex <command> .` — can be unit-tested directly, without executing the CLI's top-level `main()`. No behavior change.
