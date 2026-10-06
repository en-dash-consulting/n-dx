### Claude-specific guidance files

Claude Code loads a package's own `CLAUDE.md` when work happens under that directory — `packages/web/CLAUDE.md`, `packages/rex/CLAUDE.md`, `packages/hench/CLAUDE.md`, `packages/core/CLAUDE.md`, `packages/llm-client/CLAUDE.md`. Each is a one-line `@AGENTS.md` import; the guidance itself is in the sibling `AGENTS.md`, so edit it there.

`.claude/rules/` narrows a package's guidance to the directory you are editing (`packages/core/**`, `packages/web/src/server/**`, `packages/web/src/viewer/**`). Only Claude Code reads it, so it is for pointers, not content: do not add a registry or a policy table here, because it would be invisible to every other assistant. Its three current files still carry a full copy of sections that also live in `packages/core/AGENTS.md` and `packages/web/AGENTS.md` — edit the AGENTS.md copy, which is the canonical one; `tests/e2e/instruction-alignment.test.js` fails if the two diverge.
