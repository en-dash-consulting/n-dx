---
id: "12757fc1-b8c4-4708-945a-069398d311f7"
type: "change"
title: "Codex parity 4/9: enable capability-gated session forks"
slug: "codex-parity-4-9-enable-capability"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 4 of 9 (stack position 5 of 10).\n\nRoadmap 6a. Audit sources: llm-client/vendor-session-driver.ts:1216, vendor-session.ts:159 and hench/session-cache.ts:954. canFork=false contradicts installed CLI help and official exec fork support. Completed orientation work 649bcd2b-fcbf-4982-b02c-5c780049f63d and batch work 662bb418-12f3-41ee-85bc-cd653aa05482 remain history; this adds the missing Codex capability."
acceptanceCriteria:
  - "Implement safe Codex exec fork and warm-parent task strategy: Capability/version-gated exec fork creates a new session ID while preserving the parent's transcript."
  - "Implement safe Codex exec fork and warm-parent task strategy: Warm-parent tasks inherit orientation without appending to or mutating the shared parent."
  - "Implement safe Codex exec fork and warm-parent task strategy: Fresh/forked turns reapply sandbox, approvals, model and credential isolation; identity/policy changes invalidate cached reuse."
  - "Implement safe Codex exec fork and warm-parent task strategy: Unsupported or unavailable versions fall back with an explanation; test real supported CLI behavior separately from mocked argv."
  - "Implement safe Codex exec fork and warm-parent task strategy: Preserve existing batch/cold strategies and their worktree/branch/source/policy freshness contracts."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "00d910d1-dc49-488d-bd6f-3d26911abc79"
priority: "medium"
discoveredFrom: {"item":"649bcd2b-fcbf-4982-b02c-5c780049f63d"}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-4"
  - "stack-position-5-of-10"
source: "ndx-capture"
blockedBy:
  - "2331ee7c-5a4b-488e-8cab-82d4fe1506dc"
---
