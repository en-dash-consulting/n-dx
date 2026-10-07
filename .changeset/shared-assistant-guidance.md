---
"@n-dx/core": patch
---

Share the architecture governance sections with every assistant. The zone
fragility governance, gateway modules, spawn-versus-gateway and concurrency
contract sections — including the PRD write invariant — lived only in
`claude-addendum.md`, so `AGENTS.md` never carried them and Codex ran without
the gateway rules. They now live in `project-guidance.md`; the addendum keeps
only the pointers to Claude's per-directory `CLAUDE.md` files. A heading in the
addendum that is not on the Claude-only allowlist now fails
`tests/e2e/instruction-alignment.test.js`.
