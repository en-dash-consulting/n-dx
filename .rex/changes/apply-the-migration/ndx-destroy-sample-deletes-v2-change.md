---
id: "cb7499c4-dcdd-416f-9aab-f2ba10eac048"
type: "task"
title: "ndx destroy-sample deletes v2 change folders outside the PRD lock"
slug: "ndx-destroy-sample-deletes-v2-change"
description: "Verdict: should-fix (medium). packages/core/sample-app.js removeV2Items deletes <rexDir>/changes/(inbox/)<slug>/ with rmSync, because rex has no v2 delete verb. It takes no PRD lock and logs nothing. Scenario: `ndx start` is up, or an MCP edit_item is in flight, holding a model read before the rmSync. Its writePrdModel then re-plans the sample change's files from the in-memory model and writes them back, so the change comes back after destroy reported success. A writer mid-transaction can also leave a half-removed folder. Reachable through `ndx destroy-sample` on any v2 project while another PRD writer runs. The concurrency contract already says not to pair writers, which lowers the severity. Options: (a) add a rex v2 remove verb (`rex remove <change-id>`, which withPrdModelTransaction plus writePrdModel({removed}) support today) and spawn it from core. This is the recommended option: it routes through the lock and the execution log. (b) Take the PRD lock in core. This is rejected because core must not reach into rex's lock format."
acceptanceCriteria:
  - "rex remove accepts a v2 change id and deletes the change and its tasks inside withPrdModelTransaction"
  - "ndx destroy-sample on a v2 project removes the sample change by spawning rex, not by deleting folders from core"
  - "destroy-sample against a v2 tree whose PRD lock is held fails naming the holder instead of deleting"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
