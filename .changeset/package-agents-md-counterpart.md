---
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Every package's guidance now lives in its `AGENTS.md`, with the `CLAUDE.md`
beside it reduced to the `@AGENTS.md` import. Zone policies and seam registries
for `core`, `rex`, `hench` and `web` were readable only by Claude Code before
this; Codex and any other assistant that reads nested `AGENTS.md` files now get
them too. `tests/e2e/instruction-alignment.test.js` fails a package CLAUDE.md
with no AGENTS.md beside it, or one carrying content of its own.
