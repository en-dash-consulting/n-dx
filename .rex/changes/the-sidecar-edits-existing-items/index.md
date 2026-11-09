---
id: "fc83b4cb-5237-4422-b590-d743d0f11c37"
type: "change"
title: "The Sidecar edits existing items, changes a task's status, tags new items and asks with choices"
slug: "the-sidecar-edits-existing-items"
intent: "Found in user testing on 2026-11-05 against main a5748057f (triage: workshop analysis/sidecar/user-testing-2026-11-05.md). The Sidecar can add items and place changes but cannot touch an existing item: no tags, acceptance criteria, description or priority edits, and its Describe lens tells the agent it cannot fix criteria (server/sidecar/lens-instructions.ts:111). That also leaves the Plan redesign's \"Tighten with Sidecar\" (S8) with no way to write the tighter criteria it proposes. Decision UT2: edit and status now, each on an approval card; move, merge and apply stay with rex for now. A tester also had to type answers to the agent's multiple-choice questions."
acceptanceCriteria:
  - "The Sidecar can edit an item and change a task's status behind approval, and asks choices on a card (tests)"
touches:
  - "5cfa1d83-839a-47a1-ae42-4353cd1acf83"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
source: "ndx-capture"
---
