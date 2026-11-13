---
id: "b2f8cfa9-a4c8-42bb-909f-e51db395362f"
type: "change"
title: "Wave 1 review: isolate auth verdicts and bound their freshness"
slug: "wave-1-review-isolate-auth-verdicts"
intent: "Repair only the approved review findings on PR #1003. Cross-references: c963030c-f6cd-4e05-a927-d18cf0af5adb, e46feb51-c637-4b86-b39e-cb8ab72f0dc7. These are follow-ups to existing work, not duplicate captures or a new implementation PR. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Complete the separately approved review tasks on their owning existing PR, preserving dependency order and validation evidence."
touches:
  - "07e4564e-e181-42c1-be5a-20a16c8d2649"
priority: "medium"
discoveredFrom: {"item":"c963030c-f6cd-4e05-a927-d18cf0af5adb"}
source: "ndx-capture"
---
