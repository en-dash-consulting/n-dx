---
id: "a17ddff8-ab07-462f-bac4-58f8ce2918e7"
type: "task"
title: "A post-switch prd_tree/ removal that fails partway tells the user a re-run fixes it, but the re-run with the plan refuses"
slug: "a-post-switch-prd-tree-removal-that"
description: "Adversarial review of 6139ac49 (commit cc2d4d946), should-fix, medium.\n\npackages/rex/src/migrations/v1-to-v2/apply.ts removeAfterSwitch: when rm of prd_tree/ fails after the switch, the message says \"Run ndx migrate --apply again to remove them\". The failure case it targets is a held handle on Windows. Node's recursive rm deletes children first, so a held *file* handle deep in prd_tree/ (antivirus scanning one index.md) leaves a partial tree: some item folders gone, others kept.\n\nThe re-run then goes through leftoverV1 (apply.ts ~line 930): the partial tree's digest no longer matches plan.header.source.digest. With a plan given, missing.length === 0 does not return \"ids\" (that path is `!plan` only), so apply throws \"differs from the tree the plan was made from … remove prd_tree/ and tree-meta.json by hand\". A folder emptied of its index.md but left as a directory may also trigger the \"does not read cleanly\" refusal. Data is safe (everything is in v2), but the instruction the user was given does not finish the job, and the follow-up message points at re-capture for edits that never happened.\n\nReachable: `ndx migrate --apply <plan>` on Windows with a file handle held under prd_tree/ (PLAUSIBLE, not reproduced; the root-handle case leaves an empty dir and does converge via proof \"empty\").\n\nOptions:\n1. (recommended) In leftoverV1, accept a leftover whose ids are all in the v2 tree and are a subset of the plan's source ids even when a plan is given, when the tree is a strict subset of the plan's tree (no item edited — compare per-item fingerprints against the plan source). Cost: a fingerprint comparison; risk: low, keeps the \"edit after plan\" refusal for real edits.\n2. Change removeAfterSwitch's message to say \"run ndx migrate --apply again without the plan\" when the failure left a partial tree. Cost: trivial; risk: users learn to drop the plan, which weakens the digest guard.\n3. Pass maxRetries to rm. Ryan ruled retry machinery out (2026-10-12)."
acceptanceCriteria:
  - "With rm of one nested file under prd_tree/ made to fail after the switch (so other item folders are already removed), re-running apply with the same plan removes the leftover and reports it, instead of refusing as 'differs from the tree the plan was made from' (test)"
  - "A prd_tree/ beside the v2 tree that holds an item edited after the plan is still refused (existing test keeps passing)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lane-migration"
  - "v2-migrate-l7"
source: "ndx-adversarial-review"
---
