---
id: "f5e0685e-e842-45df-b98b-7b585cd6e1cc"
type: "change"
title: "Wave 1 review: qualify experimental Sidecar release notes"
slug: "wave-1-review-qualify-experimental"
intent: "Repair only the approved review findings on PR #998. Cross-references: fc83b4cb-5237-4422-b590-d743d0f11c37, 6383a949-3657-4802-ad9d-c90885b2f546. These are follow-ups to existing work, not duplicate captures or a new implementation PR. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Complete the separately approved review tasks on their owning existing PR, preserving dependency order and validation evidence."
touches:
  - "5cfa1d83-839a-47a1-ae42-4353cd1acf83"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
discoveredFrom: {"item":"fc83b4cb-5237-4422-b590-d743d0f11c37"}
source: "ndx-capture"
---
