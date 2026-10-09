---
id: "d5ac48da-be55-48df-ac90-7aa5cbf4a5e5"
level: "task"
title: "Nothing stops AGENTS.md growing past Codex's 32 KiB project-doc limit, where Codex silently drops the tail"
status: "completed"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T01:25:43.927Z"
completedAt: "2026-10-08T01:25:43.927Z"
endedAt: "2026-10-08T01:25:43.927Z"
resolutionType: "code-change"
resolutionDetail: "tests/e2e/agents-md-size-budget.test.js asserts the rendered root AGENTS.md stays under 32768 minus a 2 KiB margin and leaves a package file at least 2 KiB of room, with a failure message naming the limit and that Codex silently drops the rest. Codex docs (config-basic, config-reference, config-advanced) confirm project_doc_max_bytes and the truncation but publish no default number, so 32 KiB is stated as a project budget, not a documented constant. To make the guard meaningful rather than 109 bytes from red, the root was condensed from 30,611 to 26,628 bytes by moving reference prose to docs (web zone diagram -> packages/web/AGENTS.md pointer; gateway export inventory -> docs/architecture/gateways.md; concurrency reasoning -> new docs/architecture/prd-write-concurrency.md), keeping every rule in-context and every pinned vendor-neutral heading. rex, core, llm-client and hench chains now fit. web remains over by 15,329 and is the sibling task fabfa3a2, where the per-package check becomes an assertion."
acceptanceCriteria:
  - "Codex's current default for project_doc_max_bytes is confirmed against its docs, and the limit used in the test cites the source"
  - "A test fails when renderAgentsMd() output reaches the Codex project-doc byte limit minus a stated margin"
  - "The test's failure message names the limit and says that Codex silently drops the rest of AGENTS.md"
description: "Found by an adversarial review of commit dd765faaf, which moved the shared governance sections into project-guidance.md. Verdict: should-fix.\n\nScenario: by default Codex reads at most `project_doc_max_bytes` (documented default 32 KiB = 32768 bytes) of AGENTS.md and drops the rest without saying so. Commit dd765faaf took the root AGENTS.md from 16,492 to 28,884 bytes, about 88% of that budget. Everything Codex-specific is rendered last by renderAgentsMd (packages/core/assistant-assets.js:420): Workflow, Available Skills, MCP Servers, When to Use Each Server, and Codex Troubleshooting. The next ~3.9 KB added to project-guidance.md would push those sections past the limit. Codex would then run without the workflow steps and MCP tool reference, and every test would stay green. No test checks the rendered size today. tests/e2e/assistant-body-drift.test.js only proves the committed file matches the generator.\n\nReachable: yes, through any edit to packages/core/assistant-assets/project-guidance.md followed by `ndx init`. Nothing is truncated today, so there is no current failure.\n\nOptions:\n(a) Recommended. Add an e2e test that asserts Buffer.byteLength(renderAgentsMd()) stays below 32768 minus a margin (for example 30720), with a failure message pointing at the limit. This costs one test and carries no risk.\n(b) Reorder renderAgentsMd so the Codex-operational sections come before the shared guidance. A truncation would then cut architecture prose instead of the workflow. This changes the AGENTS.md layout and breaks the section-order assertions in codex-artifact-validation.test.js.\n(c) Have `ndx init` write `project_doc_max_bytes` into .codex/config.toml. That pushes a per-machine setting onto users, so it is not recommended.\n\nBefore choosing, confirm the current Codex default for project_doc_max_bytes.\n\nTriage 2026-10-07: raised to high. Root AGENTS.md grew from 28,884 bytes at capture to 30,611 on main (2,157 bytes of headroom). Run together with fabfa3a2 before roadmap PR 24; a size-budget test should fail the build before Codex silently drops the tail."
lastModified: "2026-10-08T01:25:44.539Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
