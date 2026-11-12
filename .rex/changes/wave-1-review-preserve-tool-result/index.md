---
id: "2d2dc50f-e283-4a85-b734-f422107cc02c"
type: "change"
title: "Wave 1 review: preserve tool-result vendor and success semantics"
slug: "wave-1-review-preserve-tool-result"
intent: "Repair only the approved review findings on PR #1006. Cross-references: b37b71d8-e1f6-43d3-9efb-4a82d82d2acf. These are follow-ups to existing work, not duplicate captures or a new implementation PR. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Complete the separately approved review tasks on their owning existing PR, preserving dependency order and validation evidence."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
discoveredFrom: {"item":"b37b71d8-e1f6-43d3-9efb-4a82d82d2acf"}
source: "ndx-capture"
---
