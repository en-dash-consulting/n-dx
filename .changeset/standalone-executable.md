---
"@n-dx/core": patch
---

`ndx` can run as a single standalone executable with Node.js built in, and `ndx which`, `ndx init` and the update notice now recognize that install.

Build one with `pnpm build:exe` (or `node scripts/build-exe.mjs --target=all`); the Standalone executables workflow builds and smoke-tests every platform on its own runner. The executable unpacks its runtime once per version into a per-user cache (`NDX_EXE_CACHE` overrides it) and also runs n-dx's own child scripts, so every subcommand, the dashboard and both MCP servers work from the one file.

Running from it, `ndx which` reports `standalone executable`, the update notice links to the release downloads instead of suggesting `npm i -g`, and `ndx init` writes `ndx` rather than `n-dx` into `.mcp.json` when the project does not name a command, because the executable is one file under one name. See docs/guide/standalone-executable.md.
