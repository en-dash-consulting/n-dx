---
id: "4412d39a-4407-4f26-9cae-a898cfd1ab4b"
level: "task"
title: "stableKey collision comparison counts sync bookkeeping as content, steering operators toward --replace"
status: "completed"
priority: "medium"
tags:
  - "pr-review"
  - "severity:medium"
source: "pr-review"
startedAt: "2026-09-10T20:24:43.274Z"
completedAt: "2026-09-10T20:37:46.139Z"
endedAt: "2026-09-10T20:37:46.139Z"
resolutionType: "code-change"
resolutionDetail: "Collision kind now ignores lastModified, lastModifiedBy, lastSyncedAt and remoteId, so --replace is only recommended over real content differences. The field list is declared once as ITEM_BOOKKEEPING_FIELDS in sync.ts and shared — it had been written three times, twice in sync.ts as byte-identical sets. itemSignature was deliberately not reused wholesale: it folds children in as an id list, which would make a parent read as differing merely because the bundle brought a new child. 4 unit tests (2 red first, 2 guards), plus the round-trip e2e test tightened to assert collision kind rather than only count — as written it passed either way, which is why the defect survived it. Verified against the built mergeBundle before and after: the two spurious cases flipped to identical, a real edit still differing."
acceptanceCriteria:
  - "Collision kind ignores lastModified, lastModifiedBy, lastSyncedAt, and remoteId"
  - "Re-importing an unmodified export reports every collision as identical, with no --replace suggestion"
  - "The round-trip e2e test asserts collision kind, not just count"
description: "Verdict: valid (verified). stableKey (core/prd-bundle.ts:450) excludes only `children`, while itemSignature (core/sync.ts:276) answers the same \"same content?\" question and excludes lastModified, lastModifiedBy, lastSyncedAt, remoteId via SIGNATURE_IGNORED. Round-tripped items whose only delta is bookkeeping (import stamps lastModified; sync stamps lastSyncedAt) are reported as \"differing\" collisions, and reportOutcome then closes with \"Use --replace to overwrite the tree with the bundle instead\" — pointing at a destructive command over deltas that are not content.\n\nThe e2e test \"re-importing the same bundle is a no-op\" asserts the collision count but not the collision kind, so it passes either way.\n\nSolution: make sameContent ignore the SIGNATURE_IGNORED fields — either export itemSignature from sync.ts and reuse it, or filter those keys in stableKey. Then tighten the e2e test to assert kind === \"identical\" for a round-trip. Keeps the two equality notions from drifting."
lastModified: "2026-09-10T20:37:46.145Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
