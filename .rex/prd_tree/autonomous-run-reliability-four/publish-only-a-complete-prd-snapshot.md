---
id: "f30e0ef3-a0f2-45cb-80d6-3bceec23003c"
level: "task"
title: "Publish only a complete PRD snapshot after a retry"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "rex"
  - "snapshot"
source: "ndx-adversarial-review"
startedAt: "2026-09-14T04:50:41.337Z"
acceptanceCriteria:
  - "After any retry, a successful backup contains exactly the files present in the source at the successful-copy boundary; it cannot retain files copied by an earlier failed attempt."
  - "A deterministic partial-copy retry regression deletes or changes an entry between attempts and proves restoring the successful snapshot cannot resurrect the obsolete entry."
  - "Existing concurrent-writer and backup-directory-claim behavior remains covered, and the focused Rex snapshot tests pass."
  - "A patch changeset for @n-dx/rex is included."
description: "PR #370 review found that snapshotPrdTree retries fs.cp into the same claimed backup directory. When a partial first copy sees a concurrent deletion, a later successful retry can retain entries that no longer exist in the source; restoring that backup can resurrect deleted PRD items. Make every retry produce an exact source snapshot by clearing safely before retrying or using isolated staging plus atomic publication. Add a partial-copy retry regression test."
lastModified: "2026-09-14T05:04:46.015Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
