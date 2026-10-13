---
id: "472adfe6-f575-4b8a-9433-2182a612add7"
level: "task"
title: "rex validate runs the prd_tree/ slug and identity checks on a v2 tree"
status: "completed"
priority: "medium"
tags:
  - "pr-33"
  - "lane-rex-store"
  - "rex"
  - "review-2026-10-12"
startedAt: "2026-10-12T19:33:18.194Z"
completedAt: "2026-10-12T19:43:31.808Z"
endedAt: "2026-10-12T19:43:31.808Z"
resolutionType: "code-change"
resolutionDetail: "rex validate skips the prd_tree/ slug and identity checks on a v2 tree (run 10499c02, 29b713ef8 before the restack onto #716)."
acceptanceCriteria:
  - "On a v2 copy with a stray prd_tree/ named from other titles, rex validate does not fail on tree slug convention or tree identity (test in packages/rex/tests/e2e/cli-v2-serve.test.ts)"
  - "v1 validate behaviour unchanged: existing validate tests pass unedited"
description: "Found while fixing d1dc7f68. On a v2 tree (product/ present) with a stray .rex/prd_tree/, cli/commands/validate.ts still runs \"tree identity\", \"tree slug convention\" and \"tree slug rule marker\" against prd_tree/, comparing its paths to the change-layer items. A stray tree named from stale titles fails validate with \"Path does not match the current slug rule ... run rex migrate-slugs\", which is wrong advice on v2 (prd_tree/ is not the PRD). Reproduce: copy packages/rex/tests/fixtures/v2-tree, serializeFolderTree a same-id v1 tree with different titles into .rex/prd_tree, run `rex validate`. Fix: skip the three prd_tree/ checks when the store is the change layer (isChangeLayerStore), or report the stray tree as one warning naming it."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T19:43:32.059Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
