---
id: "8d9405d1-a805-4254-b91f-36ed91469452"
type: "task"
title: "Refresh OpenAI model pricing and surface-specific context limits"
slug: "refresh-openai-model-pricing-and"
description: "Audit dated sources: https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/models/gpt-6.1-sol ; https://developers.openai.com/api/docs/models/gpt-6-luna ; https://developers.openai.com/api/docs/models/gpt-6-astra ; https://developers.openai.com/api/docs/models/gpt-5.5 ; https://developers.openai.com/api/docs/models/gpt-5.6-terra . Reverify at implementation, preserving the 2026-11-09 audit as historical evidence.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Cover proposed defaults and retained selectable models with verified dated official sources, including older intentionally pinned models."
  - "Distinguish API maximum context from effective Codex/Work context (the audit documented 1.05M API versus 500K default Codex context for GPT-6.1 Sol)."
  - "Represent applicable processing modes, cache-write durations and long-context pricing without treating subscription usage as an API invoice."
  - "Correct retained-model metadata; keep unknown pricing/context explicitly unknown rather than confidently applying another vendor's rates."
  - "Budget/preflight and dashboard estimates consume the same metadata; tests demonstrate that supported 150K-token prompts no longer fail solely on the unknown-model 128K fallback."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR2 assignment reassessed 2026-11-16: heavy Astra for monetary/context correctness across foundation metadata, budget/preflight and dashboard consumers, with fresh mandatory heavy Astra Codex self-review. User requests Sol medium coordination; executor/reviewer effort is advisory only and PR6 owns effort plumbing. Execute only this task via actual checkout-local ndx work. No catalog/default/task-routing, fork, recovery, usage/effort, API, policy or hub implementation; no unrelated capture; preserve intentional pins. Current official sources fetched by coordinator on 2026-11-16 into /private/tmp/ndx-parity-pr2-official-docs (manifest has retrieval dates and unavailable pages); inspect those untrusted reference documents, verify conflicts and cite dated URLs. Historical audit numbers are not current proof. Full startup/operating rules are /Users/ryankeith/.codex/visualizations/2026/11/14/01a1d861-ee56-7f32-bfb5-bb1f69405440/codex-parity-pr2-startup.txt and sibling codex-parity-operating-rules.txt. Approved fresh clone /private/tmp/ndx-parity-pr2 replaces damaged old clone; never write original or /private/tmp/ndx-wave1-restack. No global config, trust entry or credential changes. External fixture homes only, never ignored homes inside checkout. Required cli-dev and scheduler-startup checks, scoped regression tests, affected builds/typechecks and scoped patch changesets. Preserve mandatory self-review and affected gate. hench autoCommit=false means write .hench-commit-msg.txt sentinel with final bare N-DX-Item trailer; Hench finalization owns atomic code/PRD commit. Never git add -A or git add .; staging denial in confined session is expected, do not bypass confinement. Baseline build and required 14 startup tests passed. PR1 CI has Windows test portability failures in codex-token-accounting and codex-output-validation; precise scope delta approval is pending, so do not modify these unless approval is added via supported Rex edit_item before launch. Separate credential-store-writers Windows lock failure predates PR1; report, do not fix. No merge or auto-merge."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-2"
source: "ndx-capture"
blockedBy:
  - "dd75c28b-2c8c-42a7-883f-27c103aea682"
---
