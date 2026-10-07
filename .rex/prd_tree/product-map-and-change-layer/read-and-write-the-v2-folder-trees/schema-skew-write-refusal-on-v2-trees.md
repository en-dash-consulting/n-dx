---
id: "591e0105-6dcf-4f3f-a676-acffa64f6ea4"
level: "task"
title: "Schema-skew write refusal on v2 trees depends on writers calling assertPrdModelWritable"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-09"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With product/index.md stamped rex/v3 and state.yaml stamped rex/v2, every v2 tree write path refuses with the SchemaSkewError message (test)"
  - "The refusal happens under the PRD lock, before any file is written (tree is byte-identical after the refused write; test)"
description: "Failure: under NDX_IGNORE_SCHEMA_SKEW, loadPrdModel marks the model readOnly. The only thing that refuses a write is assertPrdModelWritable (packages/rex/src/store/prd-model-reader.ts), and nothing makes a writer call it. saveStateFile refuses only when the state.yaml file's own stamp is not v2. Scenario: product/index.md is stamped rex/v3 by a newer ndx, but its state.yaml files still say rex/v2. A v2 writer that skips assertPrdModelWritable then saves state.yaml into the v3 tree, and the stamp check passes.\n\nReachability: none today, because no v2 writer exists. It becomes reachable when the sibling task \"Write the v2 trees with frozen slugs and no Children tables\" lands.\n\nVerdict: should-fix (adversarial review of task 12138fcd), medium.\n\nOptions:\n(a) Recommended. Have the v2 writer re-read the root product/index.md stamp under the PRD lock and refuse a non-v2 stamp, the same way assertSlugRuleWritable re-reads tree-meta in the v1 store. This does not depend on the caller.\n(b) Have saveStateFile take the root stamp or the model and refuse there. This is narrower but couples the state writer to the root header."
lastModified: "2026-10-07T16:58:30.548Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
