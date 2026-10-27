---
id: "914531b6-c86b-43d3-ba44-8cae105ff86a"
type: "change"
title: "Validate a placement proposal against the shared amendment schema"
slug: "validate-a-placement-proposal-against"
intent: "P2 finding from the review of PR #585 (inline comment 4215572233), reproduced by the reviewer. asProposal (packages/rex/src/core/placement.ts) checks the identifying fields and casts the rest of the model output to PlacementProposal, so a proposal with proposed: 42 and criteria: { add: null } is returned without a warning although AmendmentSchema.safeParse rejects it; a caller then gets an invalid change or a TypeError when apply hashes the statement. Validate the proposal with the shared AmendmentSchema from schema/v2.ts first, then the proposal-specific checks; drop a malformed proposal (or its malformed optional fields) with a warning. Regression with an injected model returning that proposal. Stay in core/placement.ts and its tests; commit the work."
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
priority: "high"
---
