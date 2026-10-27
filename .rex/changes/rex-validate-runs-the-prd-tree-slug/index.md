---
id: "472adfe6-f575-4b8a-9433-2182a612add7"
type: "change"
title: "rex validate runs the prd_tree/ slug and identity checks on a v2 tree"
slug: "rex-validate-runs-the-prd-tree-slug"
intent: "Found while fixing d1dc7f68. On a v2 tree (product/ present) with a stray .rex/prd_tree/, cli/commands/validate.ts still runs \"tree identity\", \"tree slug convention\" and \"tree slug rule marker\" against prd_tree/, comparing its paths to the change-layer items. A stray tree named from stale titles fails validate with \"Path does not match the current slug rule ... run rex migrate-slugs\", which is wrong advice on v2 (prd_tree/ is not the PRD). Reproduce: copy packages/rex/tests/fixtures/v2-tree, serializeFolderTree a same-id v1 tree with different titles into .rex/prd_tree, run `rex validate`. Fix: skip the three prd_tree/ checks when the store is the change layer (isChangeLayerStore), or report the stray tree as one warning naming it."
acceptanceCriteria:
  - "On a v2 copy with a stray prd_tree/ named from other titles, rex validate does not fail on tree slug convention or tree identity (test in packages/rex/tests/e2e/cli-v2-serve.test.ts)"
  - "v1 validate behaviour unchanged: existing validate tests pass unedited"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "medium"
tags:
  - "pr-33"
  - "lane-rex-store"
  - "rex"
  - "review-2026-10-12"
---
