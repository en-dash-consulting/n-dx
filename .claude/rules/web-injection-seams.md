---
paths:
  - "packages/web/src/server/**"
---

# Web injection seam registry

The registry lives in the **"Web injection seam registry"** section of
`packages/web/AGENTS.md`, which `packages/web/CLAUDE.md` imports — so Claude
Code already has it loaded under this path. Read it there. It lists the
callback-injection seams inside the web package that static analysis cannot
see (`boundary-check.test.ts`, `domain-isolation.test.js` are blind to them),
and the rules for adding one.

This file exists only for its `paths:` scoping. Keep it a pointer: `.claude/`
is read by Claude Code and by nothing else, so content kept here is invisible
to Codex and every other assistant.

A new package's seam registry goes in that package's own `AGENTS.md`, with its
`CLAUDE.md` reduced to the `@AGENTS.md` import — `packages/llm-client/` is the
reference pair. Do not add a `.claude/rules/` registry for it.
