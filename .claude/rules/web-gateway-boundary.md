---
paths:
  - "packages/web/src/viewer/**"
  - "packages/web/src/shared/**"
  - "packages/web/src/schema/**"
---

# Web viewer gateway boundary

The boundary is described in the **"Web viewer gateway boundary"** section of
`packages/web/AGENTS.md`, which points at `packages/web/src/viewer/AGENTS.md`
where the rule sits beside the code. Both are nested `AGENTS.md` files, so
every assistant reads them under this path. They cover what
`src/viewer/external.ts` concentrates, and the two exemptions from the root
gateway rule that apply here: the viewer's type-import exemption and the
`src/viewer/messaging/` → `src/shared/` direct-import exemption.

This file exists only for its `paths:` scoping. Keep it a pointer: `.claude/`
is read by Claude Code and by nothing else, so content kept here is invisible
to Codex and every other assistant.
