---
id: "7145d6bc-5c6c-46bb-af89-cc65da8337f2"
level: "feature"
title: "Retire prd.md and Promote Folder-Tree to Exclusive PRD Backend"
status: "completed"
source: "smart-add"
startedAt: "2026-04-29T14:13:04.054Z"
completedAt: "2026-04-29T14:13:04.054Z"
endedAt: "2026-04-29T14:13:04.054Z"
acceptanceCriteria: []
description: "Flip the PRDStore read/write layer so the epic → feature → task → subtask folder tree is the sole authoritative storage. Remove all remaining paths that read from or write to prd.md so that file is never created, consulted, or maintained by any part of the system."
---

## Children

| Title | Status |
|-------|--------|
| [Audit all read and write call sites that still reference prd.md as primary storage](./audit-all-read-and-write-call-6fa121.md) | completed |
| [Remove prd.md read fallback from PRDStore and all CLI, MCP, and web consumers](./remove-prd-md-read-fallback-1e7c95.md) | completed |
