---
id: "4412d39a-4407-4f26-9cae-a898cfd1ab4b"
level: "task"
title: "stableKey collision comparison counts sync bookkeeping as content, steering operators toward --replace"
status: "pending"
priority: "medium"
tags:
  - "pr-review"
  - "severity:medium"
source: "pr-review"
acceptanceCriteria:
  - "Collision kind ignores lastModified, lastModifiedBy, lastSyncedAt, and remoteId"
  - "Re-importing an unmodified export reports every collision as identical, with no --replace suggestion"
  - "The round-trip e2e test asserts collision kind, not just count"
description: "Verdict: valid (verified). stableKey (core/prd-bundle.ts:450) excludes only `children`, while itemSignature (core/sync.ts:276) answers the same \"same content?\" question and excludes lastModified, lastModifiedBy, lastSyncedAt, remoteId via SIGNATURE_IGNORED. Round-tripped items whose only delta is bookkeeping (import stamps lastModified; sync stamps lastSyncedAt) are reported as \"differing\" collisions, and reportOutcome then closes with \"Use --replace to overwrite the tree with the bundle instead\" — pointing at a destructive command over deltas that are not content.\n\nThe e2e test \"re-importing the same bundle is a no-op\" asserts the collision count but not the collision kind, so it passes either way.\n\nSolution: make sameContent ignore the SIGNATURE_IGNORED fields — either export itemSignature from sync.ts and reuse it, or filter those keys in stableKey. Then tighten the e2e test to assert kind === \"identical\" for a round-trip. Keeps the two equality notions from drifting."
lastModified: "2026-09-10T19:10:25.699Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
