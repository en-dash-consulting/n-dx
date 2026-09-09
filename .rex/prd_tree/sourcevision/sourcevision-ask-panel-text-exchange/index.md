---
id: "d339458a-b5d4-42e1-a4af-20f48a6e22a4"
level: "feature"
title: "SourceVision Ask Panel (text exchange: explain findings, refine the PRD)"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "sourcevision"
  - "ui"
  - "llm"
  - "text-exchange"
source: "ndx-capture"
acceptanceCriteria:
  - "An \"Ask\" tab appears on the SourceVision surface behind feature gate `sourcevision.ask`, following the existing `pr-markdown` gating pattern in sourcevision-tabs.ts"
  - "Submitting a question returns a text answer grounded in the current .sourcevision/ analysis data, not in the model's own assumptions about the repository"
  - "The answer offers Copy and Capture-to-PRD, and Capture creates a real PRD item under an existing parent"
  - "A finding from the Problems or Suggestions surface can be sent to the panel and explained in plain language, naming the zone and files involved"
  - "The exchange can propose refinements to existing PRD items -- not only new items -- and each proposal is applied only after explicit review, through the locked store write path"
  - "Every failure path (no analysis data, missing credentials, LLM error or timeout) states what is wrong and what to do, never a bare \"request failed\""
  - "Token spend from an ask is attributed in the usage rollup rather than lost"
  - "The rex and hench surfaces are untouched, with TODO comments marking where their equivalent panels would later be added"
description: "A gated \"Ask\" tab on the SourceVision dashboard surface providing a prompt -> response text exchange over the analyzed project. The user types a natural-language question in a textarea; the web server assembles context from the existing .sourcevision/ analysis and calls the LLM through @n-dx/llm-client (web already imports the foundation tier directly at 11 call sites, so no new gateway is required); the answer renders as markdown in the panel.\n\nBeyond free-form Q&A the panel serves two directed uses: (1) explaining a sourcevision finding in plain language, entered from the Problems/Suggestions surfaces, and (2) refining the PRD from the user's feedback and recommendations -- proposing edits to existing items, not only capturing new ones, with every mutation reviewed as a before/after diff before it is written.\n\nScope is the SourceVision surface only. Adoption on the rex and hench surfaces is deliberately out of scope and is marked with TODO comments in packages/web/src/viewer/views/sourcevision-tabs.ts, domain-rex.ts, and domain-hench.ts rather than captured as PRD items.\n\nReuse anchors already in the codebase: the pr-markdown tab gating pattern (sourcevision-tabs.ts:30), the clipboard copy workflow with execCommand fallback and permission-denied handling (pr-markdown.ts:91,308), the confirm-guarded capture-to-PRD action (overview.ts:204 -> POST /api/rex/capture-next-steps), and the rex gateway's resolveStore for in-process PRD writes (rex-gateway.ts:31)."
lastModified: "2026-09-01T14:04:10.395Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Accessibility and regression coverage for the Ask panel](./accessibility-and-regression-coverage.md) | completed |
| [Add gated Ask tab and prompt/response view shell](./add-gated-ask-tab-and-prompt-response.md) | completed |
| [Add POST /api/sourcevision/ask backed by analysis context and llm-client](./add-post-api-sourcevision-ask-backed.md) | completed |
| [Attribute Ask token spend in the usage rollup](./attribute-ask-token-spend-in-the-usage.md) | pending |
| [Explain a finding in plain language from the Problems and Suggestions surfaces](./explain-a-finding-in-plain-language.md) | pending |
| [Give each degraded mode a specific, actionable message](./give-each-degraded-mode-a-specific.md) | pending |
| [Propose and apply PRD refinements from the exchange, diff-reviewed and under the store lock](./propose-and-apply-prd-refinements-from.md) | pending |
| [Wire Copy and Capture-to-PRD actions on the answer](./wire-copy-and-capture-to-prd-actions.md) | completed |
