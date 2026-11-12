---
id: "a85b9cf9-c01a-48ec-bdec-bfbedea973f1"
type: "change"
title: "Codex parity 9/9: support confined hub sessions and custom providers"
slug: "codex-parity-9-9-support-confined-hub"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 9 of 9 (stack position 10 of 10).\n\nRoadmap 9a and 9b. Audit sources: web/sidecar/spawn-policy.ts:86 refuses Codex hub sessions, :102 refuses non-OpenAI user model_provider; viewer/hooks/use-hub-session.ts:52 fixes vendor to Claude. Existing H1 item 73f42fbb-cc9b-4c44-8798-06959e234fe2 and task a23d8599-329b-438e-b907-f6370e63e9d2 intentionally delivered Claude-only hub scope. This change adds parity and does not recapture that completed feature. Prerequisite finding 2 owns broker approval remediation."
acceptanceCriteria:
  - "Enable Codex hub sessions only after broker-only confinement is proven: Demonstrate broker-only hub operation with repository reads denied before enabling the Codex vendor selector."
  - "Enable Codex hub sessions only after broker-only confinement is proven: Preserve all operator cards/approvals, hub snapshot/context ceilings, session hosting, ledger, request/token gates and workspace isolation."
  - "Enable Codex hub sessions only after broker-only confinement is proven: Fresh/resumed sessions, Stop/cancellation and restart/recovery retain confinement; connected tools obey hub scope and allow/ask/never policies."
  - "Enable Codex hub sessions only after broker-only confinement is proven: Use disposable negative-read and approval/cancellation fixtures plus supported real-CLI/browser evidence; mark unavailable versions explicitly."
  - "Support Codex Sidecar custom providers without loading unrelated integrations: Carry only required trusted custom-provider settings/auth while keeping unrelated MCP servers, hooks and integrations excluded."
  - "Support Codex Sidecar custom providers without loading unrelated integrations: Fresh and resumed turns use the selected provider/binary/model without silent fallback to OpenAI or Claude."
  - "Support Codex Sidecar custom providers without loading unrelated integrations: Provider credentials stay out of argv, logs, fixtures and agent child shells; broker credentials and operator card approvals remain isolated."
  - "Support Codex Sidecar custom providers without loading unrelated integrations: Actionable errors distinguish unsupported CLI/provider capability, missing auth and connection failure; test with disposable provider/MCP fixtures."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "8a7b15d7-faed-4ac0-a39d-498033396dc9"
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"73f42fbb-cc9b-4c44-8798-06959e234fe2"}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-9"
  - "stack-position-10-of-10"
source: "ndx-capture"
blockedBy:
  - "8d9b361a-d4d1-4e20-a500-b37555d961c5"
---
