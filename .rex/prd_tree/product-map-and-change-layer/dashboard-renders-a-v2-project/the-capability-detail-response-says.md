---
id: "dfae74fb-f70e-4e7a-8a3a-ebfa2e1b7431"
level: "task"
title: "The capability detail response says whether the node was met and whether its spec moved since"
status: "completed"
priority: "medium"
tags:
  - "pr-36"
  - "review-2026-10-13"
  - "lane-web"
source: "review-2026-10-13"
startedAt: "2026-10-13T18:57:01.473Z"
completedAt: "2026-10-13T19:00:32.467Z"
endedAt: "2026-10-13T19:00:32.467Z"
resolutionType: "code-change"
resolutionDetail: "buildCapabilityDetail returns met and specChangedSinceMet from metAt and specHash(nodeSpec(node)); route test with a revised node reading changing; changeset soft-freeze line."
acceptanceCriteria:
  - "GET /api/rex/product/capability/:id returns fields stating whether the node was ever met and whether its spec changed since it was met, computed from metAt and the spec hash (route test with a revised node that reads changing)"
  - "Soft-freeze changeset line for the new fields; existing product route tests pass unedited"
description: "Holistic review of the combined v2 stack, 2026-10-13 (web area W5, should-fix, CONFIRMED by code; latent until #729's editor is wired). Ryan's part: a field on D1-5's capability detail response. Hal owns #729's editorialBlockedReason.\n- **Where.** #729 @ b3ce7846e `viewer/views/product-model.ts:297` (`editorialBlockedReason`) blocks only `status === \"revised\"` and `status === \"proposed\"`.\n- **Rex's rule.** Rex's status puts `changing` ahead of both. `core/product-status.ts:91-98` gives `changing` whenever a *building* change amends the node (`isBuildingChange`: placed or started). D1-5's `buildCapabilityDetail` passes that status through (`routes-rex/product.ts`, `report.status.status`).\n- **Failure (once wired).** A capability the steward already revised, whose drafted change has since been placed or started, reads \"changing\". The form then:\n  - offers \"Editorial — wording only\",\n  - promises \"It stays met\" (`capability.ts:210`),\n  - and is refused on submit by `handleProductEdit` (\"already revised…\").\n\n  A never-met capability amended by a building change also reads \"changing\" and offers editorial, which rex treats as `proposed` (a no-op). The \"a change is drafted in the Inbox\" outcome text is also wrong when a pending draft exists, because rex refreshes that draft instead.\n\n  This only bites on live data from D1-5. #729's fixtures never pair \"changing\" with a revised spec.\n- **Fix.** Do not infer from `status`. Have D1-5's capability builder add what rex knows: `metAt` present, and whether the spec still hashes to `metAt` (`specHash(nodeSpec(node)) === node.metAt`; both are already on the gateway). Derive the blocked reason from those, or better, from a rex-exported predicate so the rule has one definition.\n- **Owners.** Hal (#729), plus a field on Ryan's D1-5 wire type.\n- **Status: CONFIRMED** by code (rex status order plus the view predicate). Latent until W4 is wired.\n\n\nFix (this task): GET /api/rex/product/capability/:id (buildCapabilityDetail in routes-rex/product.ts) also returns whether the node was ever met (metAt present) and whether its current spec still hashes to metAt (specHash(nodeSpec(node)) === node.metAt, both on the gateway), e.g. { met: boolean, specChangedSinceMet: boolean }, so a client can decide editorial eligibility without reading the display status. Prefer a rex-exported predicate if one exists. Add a soft-freeze line for the new fields."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T19:00:32.772Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
