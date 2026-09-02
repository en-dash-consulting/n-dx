---
id: "c1589e68-40c4-46c7-8489-f0a99fbadfb3"
level: "task"
title: "Make the MCP and CLI write paths agree on the slug convention"
status: "completed"
priority: "high"
source: "ndx-capture"
startedAt: "2026-09-01T14:36:06.219Z"
completedAt: "2026-09-01T14:45:37.911Z"
endedAt: "2026-09-01T14:45:37.911Z"
acceptanceCriteria:
  - "The MCP and CLI write paths produce byte-identical trees for the same document"
  - "A single status update touches only the affected item and its ancestor index files"
  - "A regression test writes the same change through both paths and asserts the trees match"
description: "The two write paths currently emit different slug conventions, so the tree flip-flops on alternating writes regardless of which convention is intended. Observed 2026-09-01: a single `mcp__rex__update_task_status` call rewrote 823 files, dropping the `-<shortId>` suffix and un-truncating titles (`child-process-cleanup-and-exit-b67648` -> `child-process-cleanup-and-exit-hygiene`); all renames were R100 with zero content loss and `rex validate` still passed 10/10. A subsequent `rex update` through the CLI re-serialized the whole tree back to the id-qualified form. The MCP output matches `slugifyTitle()` (the pre-uniqueness form) while the CLI matches `slugify()`. Worth fixing before the convention change and independently of it: a one-field status update should not rewrite 823 files, and the churn would swamp any PR diff. Fix the divergence first against whichever convention is current, so the later rename is a single deliberate change rather than noise on top of an oscillation."
lastModified: "2026-09-01T14:45:37.917Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
