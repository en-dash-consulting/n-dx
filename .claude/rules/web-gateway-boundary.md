---
paths:
  - "packages/web/src/viewer/**"
  - "packages/web/src/shared/**"
  - "packages/web/src/schema/**"
---

# Web viewer gateway boundary

The boundary is described in the **"Web viewer gateway boundary"** section of
`packages/web/AGENTS.md`, which `packages/web/CLAUDE.md` imports — so Claude
Code already has it loaded under this path. Read it there. It covers what
`src/viewer/external.ts` concentrates, and the two exemptions from the root
gateway rule that apply here: the viewer's type-import exemption and the
`src/viewer/messaging/` → `src/shared/` direct-import exemption.

This file exists only for its `paths:` scoping. Keep it a pointer: `.claude/`
is read by Claude Code and by nothing else, so content kept here is invisible
to Codex and every other assistant.
