---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
---

### Rex
- Add `withTransaction` API for safe concurrent PRD writes with file locking
- Add `level` field to `edit_item` MCP tool for changing item hierarchy levels
- Fix LLM reshape response parsing with action normalization and lenient fallback
- Fix `--mode=fast` being ignored when `--accept` is passed to `reorganize`
- Extract shared archive module for prune/reshape/reorganize
- Add reorganize archiving (removed items preserved in `.rex/archive.json`)
- Proactive structure: MCP schema coverage audit test

### Hench
- Show auto-selection reasoning in run header (why task was chosen, skipped counts, unblock potential)
- Show prior attempt history in task card (retry count, last status)
- Classify changes in run summary (code/test/docs/config/metadata-only)

### Web Dashboard
- Default to showing all PRD items (fixes blank page for 100% complete projects)
- Remove redundant StatusFilter, wire status chips to tree visibility
- Smart collapse: tree starts closed when no active work
- Hide view-header, promote breadcrumb as page title
- Show sibling page icons in collapsed sidebar rail
- Move command buttons (Add, Prune) inline into search row
- Add filtered-empty state messaging

### CLI
- Surface all package commands through `ndx` (validate, fix, health, report, verify, update, remove, move, reshape, reorganize, prune, next, reset, show)
- Helpful error when running orchestrator commands on package CLIs
- Workflow-based `ndx --help` grouping (no package names in primary help)
- Skip provider prompt on re-init when config exists
- Unified init status report
- Branded ASCII art CLI header

### Docs
- New 5-minute quickstart tutorial
- New troubleshooting guide (7 common issues)
- Commands reference rewritten by workflow stage

### Infrastructure
- `@n-dx/core` included in release workflow (synced version + auto-publish)
- `/ndx-reshape` skill for PRD hierarchy restructuring
- `/ndx-capture` skill updated with automatic parent placement and dependency wiring
