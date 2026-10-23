---
id: "2f7c79a5-f12f-420e-a48e-0ab1c4e4c488"
type: "task"
title: "Placing an Inbox change strands non-tree files in changes/inbox/<slug>/ and leaves a skipped-folder warning"
slug: "placing-an-inbox-change-strands-non"
description: "Verdict: should-fix (medium). Introduced by 2898acbe (Inbox folder): changes used to never move, and now every placement moves a top-level change from changes/inbox/<slug>/ to changes/<slug>/.\n\nScenario: a change in the Inbox whose folder also holds a non-tree file (e.g. changes/inbox/tidy/notes.txt or a mockup .png). place_change with a target → the writer (packages/rex/src/store/prd-model-writer.ts, planFolder + removeStale/removeTreeFiles) writes index.md/state.yaml/tasks fresh at changes/tidy/ and deletes only .md and state.yaml from the old folder. notes.txt stays at changes/inbox/tidy/, so the folder and changes/inbox/ survive. From then on every read warns \"Folder has no index.md; skipped with its contents\" (prd-model-reader.ts readFolderNode via readInbox), and the file is separated from its change. The same happens in reverse when a #612 tree's root Inbox change is moved in.\n\nReachable: MCP place_change, rex change place, apply_change (clears needsPlacement), and the first write to a #612 tree.\n\nOptions:\n1. Move the old folder's non-tree entries along with the change when a folder node changes directory (rename them into the new folder before stale removal). Cheap, but a name clash with a new tree file needs a rule (refuse).\n2. Refuse the move while the old folder holds non-tree files, naming them. Cheapest and safe, but blocks placement until a person moves the files.\nRecommend 1, with refusal on a clash."
acceptanceCriteria:
  - "Placing an Inbox change whose folder holds notes.txt leaves notes.txt in changes/<slug>/ and removes changes/inbox/ (test)"
  - "After that placement, loadPrdModel reports no 'Folder has no index.md' warning (test)"
  - "A move whose carried file clashes with a tree file in the destination is refused before anything is written (test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "lane-rex-store"
  - "pr-23"
  - "v2-migrate-l7"
source: "ndx-adversarial-review"
---
