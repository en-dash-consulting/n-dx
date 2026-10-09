---
id: "93d19cfa-4766-4946-bdc1-77208ee1dbde"
level: "task"
title: "rex change place refusals name MCP tools and parameters: \"see get_product\", \"edit it with edit_item\""
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex change place with a --target that is not a capability or constraint is refused naming `rex product show`, not get_product (test)"
  - "No rex change place CLI refusal names an MCP tool or parameter (test over the refusal paths)"
description: "Out-of-scope finding from the adversarial review of f50da51a (CLI nothing-to-modify hint). Pre-existing in core/change-place.ts.\n\nScenario: `rex change place <change> --target=<not-a-capability>` fails with `\"x\" is not a live capability or constraint; a change is placed on one (see get_product)`. get_product is an MCP tool; the CLI user needs `rex product show`. Other ChangePlacementError messages (change-place.ts ~102, 113, 156, 159) are MCP-worded too. Only the nothing-to-modify refusal is rewritten by the CLI (change.ts placeOrExplain).\n\nReachable: every CLI place with a wrong --target. Verdict: out-of-scope, low.\n\nOptions: (1) CLI layer maps refusals by kind (give ChangePlacementError a `kind` field so CLI and MCP each render their own hint) — recommended, removes the endsWith string matching too; (2) make core messages surface-neutral (\"see the product layer\") — cheaper, less specific."
lastModified: "2026-10-09T16:07:31.201Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
