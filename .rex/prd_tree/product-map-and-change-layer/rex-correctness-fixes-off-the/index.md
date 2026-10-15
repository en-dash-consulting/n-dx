---
id: "829a078a-b4d9-49b8-ac45-45af35c08b4a"
level: "feature"
title: "rex correctness fixes off the migration path"
status: "pending"
priority: "medium"
tags:
  - "cleanup"
  - "rex"
source: "overnight-cleanup"
acceptanceCriteria: []
description: "Four small rex correctness fixes captured by reviews of the product-layer work, none on the v1-to-v2 migration path: rex usage ignoring .n-dx.json overrides, the exported computeLanding reporting an open change as landed, the v2 bundle export blaming a missing child, and save reports relative to .ndx/ on the .ndx/ layout. Overnight cleanup stack layer 2 (fix/cleanup-2-rex-correctness)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T05:56:45.702Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Bundle v2 export blames a missing child when the folder's child was skipped as invalid, and drops the reader warning naming it](./bundle-v2-export-blames-a-missing.md) | pending |
| [FileStore and FolderTreeStore save reports are relative to .ndx/, not the project root, on the .ndx/ layout](./filestore-and-foldertreestore-save.md) | pending |
| [rex usage ignores .n-dx.json rex overrides: token-store passes the wrong dir and key to loadProjectOverrides](./rex-usage-ignores-n-dx-json-rex.md) | pending |
| [The exported computeLanding still reports an open change as landed, because it takes ids rather than the change](./the-exported-computelanding-still.md) | pending |
