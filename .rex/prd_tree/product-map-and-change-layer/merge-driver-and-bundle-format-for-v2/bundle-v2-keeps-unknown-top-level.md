---
id: "dbace75b-06f6-45b3-9f9c-5de236f6b23f"
level: "task"
title: "Bundle v2 keeps unknown top-level state.yaml keys and validates the carried root header"
status: "in_progress"
priority: "medium"
startedAt: "2026-10-08T17:12:47.599Z"
acceptanceCriteria:
  - "A top-level state.yaml key other than schema and items survives rex export then rex import-bundle into an empty v2 tree, in the same folder's state.yaml (regression test)"
  - "A bundle whose header has invalid root fields (e.g. requirements not an array, stewards not a list of strings) is refused before any write and the destination tree is unchanged (test)"
  - "Unknown root header keys still round-trip"
  - "The v2 fixture still round-trips byte-identically, and a v1 bundle still imports"
description: "From the PR #589 review (ryrykeith, 2026-10-08, commit 4c302f6c1). Two should-fix findings, both reproduced by the reviewer, in packages/rex/src/store/prd-bundle-v2.ts. The bundle envelope freezes at 1.0.0 and v2 has not shipped, so change envelope v2 in place (no v3); v1 bundles must still import.\n\n1. Unknown top-level state.yaml fields are lost (prd-bundle-v2.ts:201). The collector carries each item's row but drops the other top-level keys of its folder's state file. StateFileSchema is passthrough and the state writer and the rex-state merge driver preserve those keys. Repro: append `futureTop: {\"retain\":true}` at indentation zero to the fixture's changes/add-apple-pay/state.yaml, export, import into an empty v2 tree: no warning, and the destination state.yaml no longer has futureTop.\n   Decision (Ryan's forward-compatibility rationale for option A on 1628608d): CARRY them, do not refuse. Carry each folder's top-level state.yaml keys other than `schema` and `items` in the envelope (for example on the folder's owner node, and per layer for a layer-root state.yaml), and write them back on import. Refusing would make export fail as soon as a newer rex adds a top-level key.\n2. The carried root header is not validated (prd-bundle-v2.ts:251). Only \"header is an object\" is checked, so a bundle whose header is { \"requirements\": \"not-an-array\", \"stewards\": 42 } imports and writes both into product/index.md; the next loadPrdModel reports Invalid root header. Validate the reconstructed root header against RootHeaderSchema (using the envelope's title and schema), keeping unknown keys, and refuse before any write.\n\nLane: do not edit packages/rex/src/core/, packages/rex/src/schema/v2.ts or packages/rex/src/schema/v2-rules.ts; import from them freely. Update .changeset/bundle-envelope-v2.md if the envelope description changes. The sandbox pre-approves only npm, npx, node, git, tsc and vitest commands (e.g. `npx vitest run --root packages/rex …`), never pnpm."
lastModified: "2026-10-08T17:12:48.566Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
