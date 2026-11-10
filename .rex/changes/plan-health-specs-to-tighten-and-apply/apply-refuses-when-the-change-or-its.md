---
id: "26bd2722-39dc-474b-94e9-6329564f0449"
type: "task"
title: "Apply refuses when the change or its targets moved since the preview"
slug: "apply-refuses-when-the-change-or-its"
description: "From the review of 0234dd78 (run a0a519c5), kept on the hub's call: Apply writes the product map, so an operator can approve a preview that is no longer what gets applied when another writer (MCP edit_item, a second tab) edits the change's amendments or the product nodes they target between preview and confirm. Guard it as the Inbox placement card already does (packages/web/src/server/routes-rex/placement.ts: a pinned dry run, 409 when the PRD moved). The apply preview returns a hash of the change and its targets' specs; the apply request sends it back; rex's applyChange refuses, inside its transaction and writing nothing, when the hash no longer matches; the route answers 409 and the detail panel re-reads the preview and says why. MCP apply_change without a hash keeps today's behaviour."
acceptanceCriteria:
  - "The apply preview returns a hash of the change and the specs of the product nodes its amendments target"
  - "Apply with a hash that no longer matches answers 409 and writes nothing; the check runs inside rex's apply transaction"
  - "After a 409 the detail panel re-reads the preview and tells the operator the change moved"
  - "Route and rex tests cover a matching hash, an edited amendment, an edited target node, and MCP apply_change without a hash"
priority: "medium"
source: "ndx-adversarial-review"
---
