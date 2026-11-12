---
id: "8d253019-c622-43e0-94b6-705aaa49655d"
type: "change"
title: "Wave 1 review: preserve renamed user work in Hench recovery"
slug: "wave-1-review-preserve-renamed-user"
intent: "Repair only the approved review findings on PR #1004. Cross-references: 181fe90f-cf21-4fce-9569-fb7fe52ed4c6, bc98e476-b15f-4b1d-9b24-352ca15bcf6b, 93871c16-aeb7-4027-9b76-0054a992ba41. These are follow-ups to existing work, not duplicate captures or a new implementation PR. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Complete the separately approved review tasks on their owning existing PR, preserving dependency order and validation evidence."
touches:
  - "9cea889f-17de-4b92-a97e-b7279e158578"
priority: "high"
discoveredFrom: {"item":"181fe90f-cf21-4fce-9569-fb7fe52ed4c6"}
source: "ndx-capture"
---
