---
id: "c3c42584-28ba-4e4d-9651-6859e0f80426"
level: "task"
title: "add_item and place_change store a summary-only modified amendment that apply always refuses and no tool can complete"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "After place_change records a summary-only amendment of target T, a tool path exists that makes the change applyable without hand-editing files, or the summary-only amendment is refused up front (test)"
  - "apply_change's nothing-to-modify hint names a path that actually works for an amendment already recorded (test)"
description: "Verdict: should-fix (adversarial review of bfb8ed54). That task's dry run deliberately does not count NOTHING_TO_MODIFY, because 383f9b5f decided place_change keeps recording a summary-only amendment when given no content.\n\nScenario: place_change {id, target: A1.1, relation: \"amends\"} with no proposed and no criteria (or add_item with amends [{target, delta: \"modified\", summary}]) stores an amendment that apply_change always refuses with \"nothing to modify\". A second place_change on the same target is refused (\"already amends\"), edit_item is v1-only, and no tool edits a v2 amendment. Recovery is a hand edit of the change folder, or cancel and recreate. apply_change's hint tells the user to supply content through place_change, which can no longer be done for this target. While such an amendment is present, the dry run also never reaches apply's rules-on-result check for the other amendments.\n\nEvidence: packages/rex/src/core/apply-amendments.ts applyAmendmentsProblems filters `: ${NOTHING_TO_MODIFY}`; tests/unit/cli/mcp-product-tools.test.ts:145 encodes the summary-only placement.\n\nOptions:\n1. Refuse a summary-only modified amendment in add_item and place_change (drop the filter), so the dry run covers the whole class. Requires reversing part of 383f9b5f and updating the two MCP tests.\n2. Let place_change on a target the change already amends fill in proposed/criteria of a summary-only amendment, instead of refusing \"already amends\". Keeps the two-step flow.\n3. Keep the current behaviour and fix apply_change's hint so it stops pointing at a path that is refused.\nRecommend 2 (keeps the decided flow and gives the amendment a way to be completed); this is Ryan's decision."
lastModified: "2026-10-09T06:22:16.683Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
