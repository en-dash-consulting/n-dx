---
id: "0c727192-938b-46d8-b068-2e7022139750"
type: "change"
title: "Codex parity 2/9: correct model pricing and context metadata"
slug: "codex-parity-2-9-correct-model-pricing"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 2 of 9 (stack position 3 of 10).\n\nRoadmap 4. Audit sources: llm-client config.ts MODEL_COSTS/MODEL_CONTEXT_WINDOWS, model-pricing.ts and budget-preflight.ts. GPT-6 IDs fell back to Sonnet pricing with known:false and a 128K context; retained GPT-5.5 and cache-write metadata also differed from official documentation. Add metadata before changing defaults."
acceptanceCriteria:
  - "Refresh OpenAI model pricing and surface-specific context limits: Cover proposed defaults and retained selectable models with verified dated official sources, including older intentionally pinned models."
  - "Refresh OpenAI model pricing and surface-specific context limits: Distinguish API maximum context from effective Codex/Work context (the audit documented 1.05M API versus 500K default Codex context for GPT-6.1 Sol)."
  - "Refresh OpenAI model pricing and surface-specific context limits: Represent applicable processing modes, cache-write durations and long-context pricing without treating subscription usage as an API invoice."
  - "Refresh OpenAI model pricing and surface-specific context limits: Correct retained-model metadata; keep unknown pricing/context explicitly unknown rather than confidently applying another vendor's rates."
  - "Refresh OpenAI model pricing and surface-specific context limits: Budget/preflight and dashboard estimates consume the same metadata; tests demonstrate that supported 150K-token prompts no longer fail solely on the unknown-model 128K fallback."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "405c9fcf-2258-472f-8eb7-30d5b7ae0b8a"
  - "2e921485-212e-49b8-a00a-f6666144dee4"
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-2"
  - "stack-position-3-of-10"
source: "ndx-capture"
blockedBy:
  - "dd75c28b-2c8c-42a7-883f-27c103aea682"
---
