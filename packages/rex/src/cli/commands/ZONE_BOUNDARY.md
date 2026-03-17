# Zone Boundaries in commands/

This flat directory contains files belonging to three distinct sourcevision zones.
Without subdirectories, these boundaries are invisible in the file tree.

## Zone Assignments

### rex-cli (core zone)
All files not listed below — the 27+ command handlers that form the main CLI surface.

### chunked-review (satellite zone)
- `chunked-review.ts` — interactive proposal review loop
- `chunked-review-state.ts` — pure state management and formatting

### prd-fix-command (satellite zone)
- `fix.ts` — CLI command handler for `rex fix`

## Governance

Both satellite zones have cohesion 0.25 and coupling 0.75, meeting the
dual-fragility threshold (cohesion < 0.5 AND coupling > 0.5). See CLAUDE.md
for the rex-satellite governance policy.

**Rules:**
- New files added to this directory belong to rex-cli unless explicitly assigned
- Satellite zone files should remain tightly scoped to their feature
- Domain logic belongs in `src/core/` (rex-prd-engine), not in command handlers
