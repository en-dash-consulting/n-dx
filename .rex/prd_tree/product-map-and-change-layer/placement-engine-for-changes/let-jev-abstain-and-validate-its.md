---
id: "381cbc77-8637-4a25-92cf-5766698b060f"
level: "task"
title: "Let Jev abstain and validate its confidence before confident placement"
status: "completed"
priority: "high"
startedAt: "2026-10-07T23:22:08.384Z"
completedAt: "2026-10-07T23:26:19.141Z"
endedAt: "2026-10-07T23:26:19.141Z"
resolutionType: "code-change"
resolutionDetail: "placement-policy.ts: reserved none-of-these choice (abstained, never accepted/agrees); confidence outside [0,1] or non-finite rejected with warning. Tests added."
acceptanceCriteria: []
description: "From the review on PR #579 (two P2 inline comments on packages/rex/src/core/placement-policy.ts). Both let confident mode auto-accept a placement it should not.\n\n1. No abstain. askJevPlacement asks a choice question whose options are only the rules shortlist, and confident accepts any Jev pick at confidence >= PLACEMENT_JEV_MIN_CONFIDENCE. A change whose real capability is outside the shortlist (a rules false positive) or that fits none gets a confident pick of the closest listed option, and the engine assigns it silently. Fix: add an explicit none-of-these option to the choice criteria (a reserved key that cannot collide with a capability id). A Jev answer of none-of-these is never auto-accepted in any mode, counts as Jev not agreeing under agree, and leaves needsPlacement set; the decision reports that Jev abstained.\n\n2. Unvalidated confidence. The shared Jev parser (llm-client jev-client.ts) accepts any number as confidence, so a malformed answer with confidence 1.4 or Infinity clears the 0.8 band. Fix in placement-policy.ts (do not change jev-client.ts): treat a confidence that is not finite or is outside [0, 1] as no confident pick, with a warning; confident never accepts on it.\n\nTests (mocked judge, no live Jev): Jev picks none-of-these under confident, agree and both, and nothing is auto-accepted while needsPlacement stays set; a confident none-of-these at 0.95 is not accepted; confidence 1.4, -0.1, NaN and Infinity are each rejected with a warning and not accepted; a valid 0.85 on-shortlist pick is still accepted. Stay inside the PR 12 boundary: core/placement-policy.ts and its tests only."
lastModified: "2026-10-07T23:26:19.390Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
