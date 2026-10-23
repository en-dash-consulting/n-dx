---
id: "ecc9c0bd-5e40-4367-bccd-bc42d8877beb"
type: "change"
title: "A completed but unapplied change shows as awaiting apply in the Changes view"
slug: "a-completed-but-unapplied-change-shows"
intent: "Holistic review of the combined v2 stack, 2026-10-13 (web area W6 failure 1, should-fix, CONFIRMED). Ryan's part: the stage mapping. Hal owns the settings copy and the place/apply follow-ups.\n- **Where.**\n  - #729 @ b3ce7846e `viewer/views/rex-settings.ts:53-55` (\"On review: A completed change waits for a steward to apply it\") and `:68` (\"When models agree: a pick is taken…\").\n  - #693 @ 9fee06ad3 `routes-rex/product.ts:132-136` (`stageOf`).\n- **Failure 1: `applyOn: review`.**\n  - Under `review`, a change completed from the dashboard is completed but not applied. `stageOf` maps `status === \"completed\"` to **\"in-progress\"**, so the Changes view shows it as still in progress, with nothing saying it is waiting for a steward.\n  - The dashboard has no apply action; only MCP `apply_change` and the CLI apply. `release` behaves the same until a release is stamped.\n  - #693's single PATCH also drops `completeV2Work`'s `reason` (pr693 nit), so the user gets `{ok:true}` and an \"in progress\" row.\n- **Failure 2: `placement.autoAccept`.**\n  - `git grep loadPlacementSettings|decidePlacement` finds only `migrate-plan.ts` and the migration passes. Neither dashboard add path reads it: #693's `addInboxChange` always stamps `needsPlacement`, and #724's `rex add --accept` (`add-change.ts`) only lists a shortlist.\n\nFix (this task): in routes-rex/product.ts stageOf, a change that is completed but not applied (rex.applyOn review or release) gets its own stage, e.g. \"awaiting-apply\", distinct from in-progress, and the Changes view labels it (waiting for a steward to apply it). Surface completeV2Work's reason in the single PATCH response so the dashboard can say why. Add a soft-freeze line for the new stage value on GET /api/rex/changes and the PATCH field."
acceptanceCriteria:
  - "Under rex.applyOn review, a change completed from the dashboard reads a distinct awaiting-apply stage from GET /api/rex/changes and in the Changes view, not in-progress (tests that fail on the current head)"
  - "The single completing PATCH returns completeV2Work's reason when the change was held open or left unapplied (route test)"
  - "Soft-freeze changeset lines for the new stage value and the PATCH field; v1 unchanged"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
tags:
  - "pr-36"
  - "review-2026-10-13"
  - "lane-web"
source: "review-2026-10-13"
---
