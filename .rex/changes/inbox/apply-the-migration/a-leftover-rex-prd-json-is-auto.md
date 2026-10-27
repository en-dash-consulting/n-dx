---
id: "a09e2a27-2965-4fb3-b33d-4cab94416ac4"
type: "task"
title: "A leftover .rex/prd.json is auto-migrated back into prd_tree/ beside the v2 tree after rex migrate --apply"
slug: "a-leftover-rex-prd-json-is-auto"
description: "Found by the adversarial review of 11c88bce (run 48148488). Verdict: should-fix.\n\nFailure: a project has a legacy .rex/prd.json, with no prd.json.migrated marker, beside its prd_tree/. That state occurs when the tree was made another way or a checkout brought prd.json back. While prd_tree/ exists, ensureLegacyPrdMigrated (store/ensure-legacy-prd-migrated.ts:175) returns \"tree-exists\". rex migrate --apply (migrations/v1-to-v2/apply.ts, applyV1ToV2) then removes prd_tree/ and tree-meta.json but leaves prd.json. The next PRD-touching v1 command finds prd.json and no tree, and migrates the stale prd.json into a new prd_tree/ beside product/. The two layouts then sit side by side, which breaks apply's contract. Branch-scoped prd_<branch>_<date> files and .rex/prd.md are similar: v1 reads fall back to them once the tree is gone.\n\nReachability: real but uncommon. This repository has none of these files. Sibling 2ea252fe (remove the prd.md and prd.json read fallbacks) removes the auto-migration and so closes the path, but apply ships before it.\n\nOptions:\n(a) Apply refuses while any legacy PRD source is present, naming the files and saying to move or delete them. It is cheap and writes nothing, but blocks the migration until a person acts.\n(b) Apply removes them in the same PRD transaction, as it does tree-meta.json. It needs no extra step, but deletes a file that might hold data the tree lacks.\nRecommendation: (a), because a stale source may differ from the tree and a person should decide."
acceptanceCriteria:
  - "rex migrate --apply on a v1 tree that also holds .rex/prd.json (no prd.json.migrated marker) or .rex/prd.md either refuses and writes nothing, or removes those files in the same transaction (test)"
  - "After a successful apply, no PRD-touching rex command recreates .rex/prd_tree/ (test: apply, then run a command that calls ensureLegacyPrdMigrated, then assert prd_tree/ is absent)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
---
