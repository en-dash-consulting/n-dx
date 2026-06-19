---
"@n-dx/rex": patch
---

Exclude `.claude/`, `.codex/`, `CLAUDE.md`, and `AGENTS.md` from the rex doc scanner. These are AI assistant tool config directories and generated instruction files that were being ingested as PRD proposals.
