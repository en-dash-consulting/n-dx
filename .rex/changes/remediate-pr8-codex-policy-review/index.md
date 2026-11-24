---
id: "126b867f-b94d-4976-84f7-7707e0c8f374"
type: "change"
title: "Remediate PR8 Codex policy review findings"
slug: "remediate-pr8-codex-policy-review"
summary: "Restore safe temporary storage and consistent reviewer confinement, and make the completed policy work report its status accurately."
intent: "User-authorized remediation of four review comments on PR1087 at4afdbcbded1a8f9e29a42b9186a56b615133e801. Follow-up to the applied policy change; do not alter PR9 or unrelated code. Review comment ids4631645008/4631645022/4631645041/4631645066."
acceptanceCriteria:
  - "Provide workspace-write Codex execution/review sessions with private bounded writable scratch and TMPDIR rather than the excluded host temp directory; cover normal temporary-file APIs, fresh/resume/fork behavior and cleanup without reopening broad host temp or network grants."
  - "Report unsupported Codex guards for a resolved Codex pair reviewer even when the executor is Claude, consistently in resolution/dashboard/live output/persisted diagnostics, with negative cases for non-Codex/off/API review."
  - "Correct stale original PR8 change failing status/reason through supported Rex after criteria are validated, so it agrees with completed children and evidence; never hand-edit state.yaml or mark unresolved work completed."
  - "Pin the core pair-programming Codex reviewer to read-only sandbox, approval never, strict config and credential masking through architecture-compliant helpers; prove hostile native config cannot widen the reviewer, preserving orchestration spawn/gateway rules."
  - "Pass scoped regressions, changed-package builds/typechecks, both required startup checks and fresh mandatory review; add scoped patch changesets, preserve pins/dirty work and keep PR9/merge out of scope."
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "high"
discoveredFrom: {"item":"8d9b361a-d4d1-4e20-a500-b37555d961c5"}
tags:
  - "codex-parity"
  - "codex-parity-pr-8"
  - "review-remediation"
source: "pr-review"
---
