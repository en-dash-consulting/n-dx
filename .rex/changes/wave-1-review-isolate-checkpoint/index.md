---
id: "91b18169-8511-4192-9cc1-70b0f4f41897"
type: "change"
title: "Wave 1 review: isolate checkpoint failures and finalize broker release notes"
slug: "wave-1-review-isolate-checkpoint"
intent: "Repair only the approved review findings on PR #1008. Cross-references: 4191c8d5-58d7-4153-a3fa-17f2b813d792, 49104d5b-f333-4685-82b0-51a1ad8e402f, 8d2ff447-281c-4255-8634-f2cce8bcd6cf. These are follow-ups to existing work, not duplicate captures or a new implementation PR. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Complete the separately approved review tasks on their owning existing PR, preserving dependency order and validation evidence."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "05338f33-e638-49b8-815f-ed12949f0c63"
priority: "medium"
discoveredFrom: {"item":"4191c8d5-58d7-4153-a3fa-17f2b813d792"}
source: "ndx-capture"
---
