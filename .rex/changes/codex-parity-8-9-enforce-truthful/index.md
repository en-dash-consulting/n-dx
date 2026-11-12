---
id: "8d9b361a-d4d1-4e20-a500-b37555d961c5"
type: "change"
title: "Codex parity 8/9: enforce truthful execution-policy boundaries"
slug: "codex-parity-8-9-enforce-truthful"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 8 of 9 (stack position 9 of 10).\n\nRoadmap 9c, ordered before hub enablement because the hub needs confinement proven. Audit source: hench/adapters/codex-cli-adapter.ts:59 ignores Git-subcommand scoping; normalized policy controls do not imply equivalent Codex enforcement. Preserve safety rather than enabling a vendor by weakening boundaries."
acceptanceCriteria:
  - "Enforce supported Codex policy restrictions and expose capability limits: Enforce equivalent supported command/Git restrictions or explicitly identify unsupported controls in resolution, dashboard and errors."
  - "Enforce supported Codex policy restrictions and expose capability limits: Tests allow intended read-only Git operations while denying disallowed Git subcommands and policy-boundary crossings."
  - "Enforce supported Codex policy restrictions and expose capability limits: Fresh, resumed and forked sessions preserve sandbox, approval, network/filesystem and credential-isolation posture."
  - "Enforce supported Codex policy restrictions and expose capability limits: Untrusted repository configuration cannot widen execution or silently relax approvals; unavailable versions fail safely."
  - "Enforce supported Codex policy restrictions and expose capability limits: Provide real supported-CLI boundary evidence separately from flag/argv mocks, including the confinement needed by hub sessions."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-8"
  - "stack-position-9-of-10"
source: "ndx-capture"
blockedBy:
  - "ee45742e-70be-47ff-a5af-22fa9b711412"
---
