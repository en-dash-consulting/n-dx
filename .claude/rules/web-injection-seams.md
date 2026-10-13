---
paths:
  - "packages/web/src/server/**"
---

# Web injection seam registry

The **"Web injection seam registry"** section of `packages/web/AGENTS.md`
names the three seams and sends you to the table, which lives beside the code
in `packages/web/src/server/AGENTS.md`. Both are nested `AGENTS.md` files, so
every assistant reads them under this path; Claude Code has them loaded
already. They list the callback-injection seams static analysis cannot see
(`boundary-check.test.ts` and `domain-isolation.test.js` are blind to them)
and the rules for adding one.

This file exists only for its `paths:` scoping. Keep it a pointer: `.claude/`
is read by Claude Code and by nothing else, so content kept here is invisible
to Codex and every other assistant.

A new package's seam registry goes in that package's own `AGENTS.md`, with its
`CLAUDE.md` reduced to the `@AGENTS.md` import — `packages/llm-client/` is the
reference pair. Do not add a `.claude/rules/` registry for it.
