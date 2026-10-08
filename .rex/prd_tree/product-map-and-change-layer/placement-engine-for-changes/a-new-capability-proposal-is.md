---
id: "09f9a1df-37af-4a0e-8ffb-c621fdeffd36"
level: "task"
title: "A new-capability proposal is impossible when no rule fires, and the model is never told the areas"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With an empty rules shortlist and a model that proposes, decidePlacement returns the proposal with needsPlacement set"
  - "The PlacementModel input includes the known areas"
  - "A proposal whose under is not a known area id is dropped with a warning"
  - "Tests cover each case with a mocked model seam"
description: "Verdict: should-fix (medium). Found by the adversarial review of 2fa34877.\n\nScenario: `placeChange` (packages/rex/src/core/placement.ts) returns early without calling the text model when the rules shortlist is empty. A proposal of a new capability, the case where nothing existing fits, can therefore only arise when some existing node already matched. A genuinely new feature (\"Add Jira import\") that matches no node gets `needsPlacement` with no proposal.\n\nThe model input also carries no list of areas, so the proposal's `under` cannot be grounded. `asProposal` checks only that `under` is a non-empty string, so a hallucinated area id passes and reaches the person reviewing it.\n\nReachability: no caller yet; live with place_change (PR 17).\n\nOptions:\n1. Ask the model for a proposal when the shortlist is empty, passing `areas` in the seam input, and drop a proposal whose `under` is not a known area id. This costs a model call on unmatched changes. Recommended.\n2. Keep skipping the model when nothing matched, and document that proposals are only made beside a shortlist. No cost, but it misses the main use.\n\nDecision for the user: whether an unmatched change is worth a text-model call."
lastModified: "2026-10-08T04:41:23.662Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
