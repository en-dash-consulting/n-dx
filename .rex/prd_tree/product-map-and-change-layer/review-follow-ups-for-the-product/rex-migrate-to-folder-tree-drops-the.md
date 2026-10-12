---
id: "92f9ca10-b796-4e0c-9ace-890b766afcf1"
level: "task"
title: "rex migrate-to-folder-tree drops the PRD title: it never writes tree-meta.json, so the tree reads back as \"PRD\""
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "After rex migrate-to-folder-tree converts a prd.json titled \"My Project\", .rex/tree-meta.json exists and its title is \"My Project\" (unit test)"
  - "After converting from prd.md, FileStore.loadDocument returns the source document's title, not \"PRD\" (unit test)"
description: "Found by the adversarial review of run 4131946b (task aa61a436). Verdict: out-of-scope, because it predates that change.\n\nScenario: .rex/prd.json (or prd.md) with title \"My Project\", then `rex migrate-to-folder-tree`. The command calls serializeFolderTree but never writes .rex/tree-meta.json (packages/rex/src/cli/commands/migrate-to-folder-tree.ts, cmdMigrateToFolderTree). FileAdapter.loadDocument reads the title only from tree-meta.json and defaults to \"PRD\" (packages/rex/src/store/file-adapter.ts ~503-514). So `rex status` shows \"PRD\", and `ndx migrate --apply` carries \"PRD\" into the v2 tree. By contrast, ensureLegacyPrdMigrated writes tree-meta via treeMetaContents.\n\nReachable: through the rex migrate-to-folder-tree CLI, and through the upgrade path that 2ea252fe names (\"upgrade with ndx 0.8.x first\").\n\nOptions:\n(a) Recommended. After serializing, write tree-meta.json with atomicWriteJSON(metaPath, await treeMetaContents(metaPath, doc)), as ensureLegacyPrdMigrated does. A few lines plus a unit test. Low risk.\n(b) Leave it. 2ea252fe removes the command; only projects that already ran it lose the title. Those can be fixed by hand.\n\nReproduction was by code reading. The scratch-directory run was not executed in the review session."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:03:44.744Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
