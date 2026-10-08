---
id: "8cfdb939-26d3-4b85-b89c-f418eb89d66e"
level: "task"
title: "Stamp appliedAt, refuse stale amendments and check apply's own output"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "PR 10's share of the pre-freeze review (2026-10-07, Ryan). Runs after PR 30 (feature ab9eeda9, v2 schema and rules before the freeze) has merged to main and main is merged into this branch: it uses appliedAt, appliedAmendsHash, Amendment.base and the shared applied/open predicates from schema/v2-rules.ts.\n\n- Apply stamps appliedAt (an ISO timestamp passed in by the caller) instead of an appliedIn SHA, and drops the commit option. The apply commit is not stored; it is computed from the change's N-DX-Item trailer (decision A). This removes the circularity of a commit having to contain its own SHA.\n- Apply stamps appliedAmendsHash (a hash of the amends as applied). A change whose amends no longer match its appliedAmendsHash is reported (its later amendments were never applied), never silently ignored.\n- An amendment with base set is refused when base differs from the target's current specHash, unless the caller passes force; the refusal names the change, the target and both hashes. Two changes that modify the same node can then no longer silently revert each other.\n- Apply runs checkV2Rules on the product layer it produces and refuses (returns the findings, writes nothing) when the result has an error finding the input did not have, such as an added capability nested past the depth limit or under a non-capability.\n- Use the shared isAppliedChange/isOpenChange from schema/v2-rules.ts; do not keep a local definition.\n- An added amendment with type constraint creates a constraint (statement, requirements, appliesTo) instead of a capability; without type it creates a capability, as today. Point raised by the review of PR 30 616f908a.\n\nTests for each point. Stay inside core/apply-amendments.ts (and core/product-edit.ts if needed) and their tests."
lastModified: "2026-10-08T00:26:43.918Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
