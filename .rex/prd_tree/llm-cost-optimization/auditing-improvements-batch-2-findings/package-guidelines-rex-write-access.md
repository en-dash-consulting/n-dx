---
id: "1c51e796-a618-4df4-9b88-e4f8b460e7b2"
level: "task"
title: "PACKAGE_GUIDELINES .rex/ write-access protocol documented a PRD layout that no longer exists"
status: "completed"
priority: "medium"
startedAt: "2026-09-04T22:23:37.411Z"
completedAt: "2026-09-04T22:23:37.411Z"
endedAt: "2026-09-04T22:23:37.411Z"
acceptanceCriteria: []
description: "The '.rex/ Write-Access Protocol' section described prd.md as canonical with prd.json dual-written on every save, listed both in the write-ownership table, and stated 'No file locking' as rule 2. All three are false: PRD state is the folder tree .rex/prd_tree/, prd.md and prd.json are legacy migration sources absent after migration, and rex has a PRD file lock (store/file-lock.ts) with withTransaction holding it across read-modify-write in the MCP tools and bulk restructurers. Contradicted CLAUDE.md's PRD invariant. Found by the orientation pass during an ndx work run. Rewritten to match the folder tree, the real lock semantics, and the ephemeral .cache/prd.json."
commits:
  - {"hash":"11634bb4c60b66ecf9afda843ac4f03ea9b6a396","author":"endash-shal","authorEmail":"162359954+endash-shal@users.noreply.github.com","timestamp":"2026-09-22T16:49:59-04:00"}
lastModified: "2026-09-04T22:23:37.425Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
