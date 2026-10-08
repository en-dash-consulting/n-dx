---
id: "914531b6-c86b-43d3-ba44-8cae105ff86a"
level: "task"
title: "Validate a placement proposal against the shared amendment schema"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "P2 finding from the review of PR #585 (inline comment 4215572233), reproduced by the reviewer. asProposal (packages/rex/src/core/placement.ts) checks the identifying fields and casts the rest of the model output to PlacementProposal, so a proposal with proposed: 42 and criteria: { add: null } is returned without a warning although AmendmentSchema.safeParse rejects it; a caller then gets an invalid change or a TypeError when apply hashes the statement. Validate the proposal with the shared AmendmentSchema from schema/v2.ts first, then the proposal-specific checks; drop a malformed proposal (or its malformed optional fields) with a warning. Regression with an injected model returning that proposal. Stay in core/placement.ts and its tests; commit the work."
lastModified: "2026-10-08T06:29:02.537Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
