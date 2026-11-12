---
id: "ee45742e-70be-47ff-a5af-22fa9b711412"
type: "change"
title: "Codex parity 7/9: add direct OpenAI API execution and failover"
slug: "codex-parity-7-9-add-direct-openai-api"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 7 of 9 (stack position 8 of 10).\n\nRoadmap 8, delivered as three ordered tasks in one planned implementation PR. Audit sources: hench/provider-support.ts and run-settings.ts reject Codex API tasks, while llm-client has an OpenAI text completion provider; failover can actually fire only on the Claude API loop. Cross-reference a6c968d3-f0a8-490b-8b8c-f3a07c5ce4e5 as narrower completed work, not a duplicate. GPT-6.1 Sol tool calling requires Responses API: https://developers.openai.com/api/docs/models/gpt-6.1-sol ."
acceptanceCriteria:
  - "Establish a current OpenAI tool-call codec and truthful capabilities: Support current OpenAI tool-call request, response, streaming and error contracts for selected supported models, using Responses API where required."
  - "Establish a current OpenAI tool-call codec and truthful capabilities: Round-trip tool calls/results through the existing vendor-neutral interfaces without claiming capabilities the implementation does not provide."
  - "Establish a current OpenAI tool-call codec and truthful capabilities: Preserve authentication, trusted endpoints, usage/effort metadata and cancellation semantics; secrets never enter logs/tool children."
  - "Establish a current OpenAI tool-call codec and truthful capabilities: Focused fixtures cover multi-step tool calls, tool failures, malformed responses and authentication failures."
  - "Run explicit tasks and loops through the direct OpenAI API provider: Hench accepts the Codex/OpenAI direct API provider and runs explicit tasks, sequential loops/queues and supported review settings through the API."
  - "Run explicit tasks and loops through the direct OpenAI API provider: Task claims, tool guard, trust/config precedence, test gates, retry/interruption/recovery, budgets and run accounting match applicable Claude API workflows."
  - "Run explicit tasks and loops through the direct OpenAI API provider: CLI/API discovery, init templates, dashboard provider controls and error messages reflect real support."
  - "Run explicit tasks and loops through the direct OpenAI API provider: Disposable integration fixtures demonstrate task completion, tool refusal, cancellation and failure without production task mutations."
  - "Execute bounded failover for OpenAI API runs: With failover enabled, retryable OpenAI API failures walk the supported configured model/vendor chain within finite budgets."
  - "Execute bounded failover for OpenAI API runs: Non-retryable errors are handled explicitly; exhausted failover restores original selection and original-error behavior."
  - "Execute bounded failover for OpenAI API runs: Every switch records the effective vendor/model, reason, usage and cost without leaking credentials."
  - "Execute bounded failover for OpenAI API runs: Disabled failover is a no-op; cross-vendor requests use each provider's correct message/tool format."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "2e136c81-64ea-4b4f-96ad-d070f98665e1"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
priority: "high"
discoveredFrom: {"item":"a6c968d3-f0a8-490b-8b8c-f3a07c5ce4e5"}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-7"
  - "stack-position-8-of-10"
source: "ndx-capture"
blockedBy:
  - "59ef46ac-3cae-43e7-89e0-c327f28ef32b"
---
