---
id: "7f72282a-9557-4ffe-a655-cf79979f0b5e"
type: "change"
title: "Wave 1 review: align v2 execution eligibility across the dashboard"
slug: "wave-1-review-align-v2-execution"
intent: "Repair only the approved review findings on PR #1002. Cross-references: 99df935b-e894-41c2-983b-7df37ccbdfb3. These are follow-ups to existing work, not duplicate captures or a new implementation PR. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Complete the separately approved review tasks on their owning existing PR, preserving dependency order and validation evidence."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
  - "4ca9aac4-cd85-4af3-96d9-c4274e2d9f83"
priority: "medium"
discoveredFrom: {"item":"99df935b-e894-41c2-983b-7df37ccbdfb3"}
source: "ndx-capture"
---
