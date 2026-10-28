---
id: "fc051e24-a900-4667-9d4e-7db3b1fcc377"
type: "task"
title: "recordProposal: give an open change a proposed new capability or constraint"
slug: "recordproposal-give-an-open-change-a"
description: "Add `recordProposal(tree, changeRef, proposal, now)` to `packages/rex/src/core/change-place.ts`, beside `recordPlacement`, and export it with its input and result types.\n\nInput: `type` (capability | constraint), `under` (a live area id, display id or alias), `title`, optional `summary` (default: the change's title), `proposed` (the new node's statement) and `criteria` (`{ add: [{id, text}] }`). It appends an `added` amendment to the change with a freshly minted `target` id (check how `core/apply-amendments.ts` consumes an `added` target and mint it the same way the rest of rex mints node ids), and clears `needsPlacement`.\n\nReuse the proposal check in `core/placement.ts` (`asProposal`: export it or move it beside this function) so a proposal has one definition of well-formed. Refuse with `ChangePlacementError` (new kinds as needed, each with a `plain` message): unknown or non-area `under`, empty title, a change that isn't open, rule errors from `checkV2Rules`, and problems `applyAmendmentsProblems` reports for the new amendment. Same shape as `recordPlacement`: pure, works on a copy, the caller writes.\n\nNothing is auto-accepted: the node reaches the product map only when the change is applied."
acceptanceCriteria:
  - "recordProposal appends an added amendment with type, under, title, and proposed and/or criteria, and clears needsPlacement"
  - "Refuses an under that is not a live area, an empty title, and a change that is not open, each with a ChangePlacementError kind and plain message"
  - "Refuses a proposal that checkV2Rules or the apply dry-run rejects"
  - "The input tree is not modified"
  - "An integration test applies the change and finds the proposed node on the product map under its area"
priority: "high"
tags:
  - "inbox-placement"
  - "rex"
source: "ndx-capture"
---
