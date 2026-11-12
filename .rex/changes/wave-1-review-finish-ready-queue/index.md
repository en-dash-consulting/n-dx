---
id: "3ecf3d30-ad38-4857-8225-dc858ba44c38"
type: "change"
title: "Wave 1 review: finish Ready queue documentation and controls"
slug: "wave-1-review-finish-ready-queue"
intent: "Repair only the approved review findings on PR #1000. Cross-references: b2d58519-a069-4b03-9aef-3cc5753b1055, b9f53670-8e31-4f3f-a630-786ca4800d3a. These are follow-ups to existing work, not duplicate captures or a new implementation PR. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Complete the separately approved review tasks on their owning existing PR, preserving dependency order and validation evidence."
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
discoveredFrom: {"item":"b2d58519-a069-4b03-9aef-3cc5753b1055"}
source: "ndx-capture"
---
