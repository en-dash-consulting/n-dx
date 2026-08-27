---
id: "8ee7d649-28c9-4b5f-98ac-864c27c15fa3"
level: "task"
title: "Git merge driver for .rex/prd_tree"
status: "completed"
priority: "medium"
startedAt: "2026-08-26T04:03:05.485Z"
completedAt: "2026-08-26T04:03:05.485Z"
endedAt: "2026-08-26T04:03:05.485Z"
acceptanceCriteria: []
description: "Add 'rex merge-driver <ancestor> <ours> <theirs>' performing a three-way frontmatter-aware merge of PRD markdown: union merge for tags/blockedBy, latest-lastModified wins for status/priority (depends on the lastModified stamping task), textual merge for description, conflict markers only for genuinely conflicting fields. Register '.rex/prd_tree/** merge=rex-prd' via .gitattributes and the driver in git config during ndx init, extending the existing gitattributes-pins.js mechanism. PR boundary: split into two PRs - driver core with tests, then init registration wiring. Acceptance criteria: (1) three-way merge unit tests per field class; (2) unresolvable conflicts emit standard conflict markers; (3) init registration is idempotent; (4) a repo-level integration test merges two divergent PRD branches cleanly."
lastModified: "2026-08-26T04:03:05.490Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Merge driver core: rex merge-driver command with three-way frontmatter-aware merge](./merge-driver-core-rex-merge-5a73fb.md) | completed |
| [Register rex-prd merge driver during ndx init (.gitattributes + git config, idempotent)](./register-rex-prd-merge-driver-2e82c5.md) | completed |
