---
id: "c3c42584-28ba-4e4d-9651-6859e0f80426"
level: "task"
title: "add_item and place_change store a summary-only modified amendment that apply always refuses and no tool can complete"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
  - "pr-review"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "place_change with target and relation amends but neither proposed nor criteria is refused when the delta would be modified, and nothing is written; the message says to pass proposed or criteria, or use relation touches (test)"
  - "add_item refuses a summary-only modified amendment the same way, through the existing dry-run apply (test)"
  - "place_change with relation touches, or with amends plus proposed or criteria, behaves as before (test)"
  - "No tool input shape changes; the place_change description and the proposed/criteria parameter descriptions say they are required for an amends placement that modifies a capability"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "Verdict: should-fix (adversarial review of bfb8ed54). That task's dry run deliberately does not count NOTHING_TO_MODIFY, because 383f9b5f decided place_change keeps recording a summary-only amendment when given no content.\n\nScenario: place_change {id, target: A1.1, relation: \"amends\"} with no proposed and no criteria (or add_item with amends [{target, delta: \"modified\", summary}]) stores an amendment that apply_change always refuses with \"nothing to modify\". A second place_change on the same target is refused (\"already amends\"), edit_item is v1-only, and no tool edits a v2 amendment. Recovery is a hand edit of the change folder, or cancel and recreate. apply_change's hint tells the user to supply content through place_change, which can no longer be done for this target. While such an amendment is present, the dry run also never reaches apply's rules-on-result check for the other amendments.\n\nEvidence: packages/rex/src/core/apply-amendments.ts applyAmendmentsProblems filters `: ${NOTHING_TO_MODIFY}`; tests/unit/cli/mcp-product-tools.test.ts:145 encodes the summary-only placement.\n\nOptions:\n1. Refuse a summary-only modified amendment in add_item and place_change (drop the filter), so the dry run covers the whole class. Requires reversing part of 383f9b5f and updating the two MCP tests.\n2. Let place_change on a target the change already amends fill in proposed/criteria of a summary-only amendment, instead of refusing \"already amends\". Keeps the two-step flow.\n3. Keep the current behaviour and fix apply_change's hint so it stops pointing at a path that is refused.\nRecommend 2 (keeps the decided flow and gives the amendment a way to be completed); this is Ryan's decision.\n\nDecided 2026-10-09 (Ryan): reverse the 383f9b5f carve-out. A summary-only modified amendment is something apply always refuses, so placement refuses it too, consistent with bfb8ed54's rule. Not chosen: letting a second place_change fill in an existing amendment. Lane: core/change-place.ts, cli/mcp-tools/place-change.ts (descriptions and message), tests, tools/list snapshot (descriptions only)."
lastModified: "2026-10-09T14:29:11.263Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
