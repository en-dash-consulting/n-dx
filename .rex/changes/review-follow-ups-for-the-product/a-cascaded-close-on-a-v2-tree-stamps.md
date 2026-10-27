---
id: "6d47c2af-7982-4e36-82c6-15c7e2b2bacf"
type: "task"
title: "A cascaded close on a v2 tree stamps the auto-completed change with the current actor as its author"
slug: "a-cascaded-close-on-a-v2-tree-stamps"
description: "Verdict: should-fix (medium). Introduced by 855c7516c (v2 writes stamp lastModified/lastModifiedBy).\n\nScenario: on a v2 tree, change CH-1 last edited by Sterling H has one open task. A different user runs update_task_status completed on that task (or hench completes it). completeV2Work (packages/rex/src/cli/v2-completion.ts) auto-completes CH-1 in the same withModelTransaction, and stampChangedNodes (packages/rex/src/store/prd-model-transaction.ts) stamps every changed node with the transaction actor, so CH-1's lastModifiedBy becomes the task completer. v1 keeps the cascaded ancestor's author (WriteOptions.preserveModifiedBy, #368: update-task-status.ts:186, rex update, hench tools/rex.ts:209, lifecycle/shared.ts:3490); on v2 ChangeLayerStore.updateItem ignores WriteOptions entirely, so preserveModifiedBy is dropped on every v2 path too.\n\nReachable: update_task_status / rex update --status=completed / hench completion on a change's last task.\n\nOptions:\n1. (Recommended) Let PrdModelEdit name ids whose author is preserved (preserveAuthorFor, as v1's runTransaction), stampChangedNodes keeps their lastModifiedBy and updates lastModified only; completeV2Work passes the auto-completed change ids; ChangeLayerStore.updateItem honours options.preserveModifiedBy. Cost: small, one option threaded. Risk: low.\n2. Leave as is: document that v2 attributes cascades to the actor. Cheap but diverges from v1 and #368."
acceptanceCriteria:
  - "Completing a v2 change's last task leaves the auto-completed change's lastModifiedBy unchanged and moves its lastModified (test)"
  - "ChangeLayerStore.updateItem with preserveModifiedBy: true keeps the node's existing lastModifiedBy (test)"
  - "A node with no prior lastModifiedBy still gets the current actor under preserveModifiedBy (test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "lane-migration"
source: "ndx-adversarial-review"
---
