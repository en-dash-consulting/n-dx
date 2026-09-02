---
id: "81e855bf-c278-46b7-924f-d5a3c4227b22"
level: "feature"
title: "Git-safe PRD tree merges"
status: "completed"
priority: "high"
startedAt: "2026-08-26T12:56:37.352Z"
completedAt: "2026-08-26T12:56:37.352Z"
endedAt: "2026-08-26T12:56:37.352Z"
acceptanceCriteria: []
description: "Discovery Option 2. The PRD tree is designed to be committed, but raw git merges are currently unsafe: title-only slugs collide across branches, removeStaleEntries silently bulk-deletes from stale snapshots, and there is no merge driver or post-merge validation. This feature makes divergent-branch PRD editing safe."
lastModified: "2026-08-26T12:56:37.357Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Git merge driver for .rex/prd_tree](./git-merge-driver-for-rex-prd-tree/index.md) | completed |
| [Guard removeStaleEntries against stale snapshots](./guard-removestaleentries-2eb303.md) | completed |
| [ID-qualified slugs by default plus migrate-slugs command](./id-qualified-slugs-by-default-440add.md) | completed |
| [rex validate --post-merge structural check](./rex-validate-post-merge-da1dc6.md) | completed |
