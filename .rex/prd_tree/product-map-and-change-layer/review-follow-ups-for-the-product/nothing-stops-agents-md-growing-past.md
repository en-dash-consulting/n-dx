---
id: "d5ac48da-be55-48df-ac90-7aa5cbf4a5e5"
level: "task"
title: "Nothing stops AGENTS.md growing past Codex's 32 KiB project-doc limit, where Codex silently drops the tail"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Codex's current default for project_doc_max_bytes is confirmed against its docs, and the limit used in the test cites the source"
  - "A test fails when renderAgentsMd() output reaches the Codex project-doc byte limit minus a stated margin"
  - "The test's failure message names the limit and says that Codex silently drops the rest of AGENTS.md"
description: "Found by an adversarial review of commit dd765faaf, which moved the shared governance sections into project-guidance.md. Verdict: should-fix.\n\nScenario: by default Codex reads at most `project_doc_max_bytes` (documented default 32 KiB = 32768 bytes) of AGENTS.md and drops the rest without saying so. Commit dd765faaf took the root AGENTS.md from 16,492 to 28,884 bytes, about 88% of that budget. Everything Codex-specific is rendered last by renderAgentsMd (packages/core/assistant-assets.js:420): Workflow, Available Skills, MCP Servers, When to Use Each Server, and Codex Troubleshooting. The next ~3.9 KB added to project-guidance.md would push those sections past the limit. Codex would then run without the workflow steps and MCP tool reference, and every test would stay green. No test checks the rendered size today. tests/e2e/assistant-body-drift.test.js only proves the committed file matches the generator.\n\nReachable: yes, through any edit to packages/core/assistant-assets/project-guidance.md followed by `ndx init`. Nothing is truncated today, so there is no current failure.\n\nOptions:\n(a) Recommended. Add an e2e test that asserts Buffer.byteLength(renderAgentsMd()) stays below 32768 minus a margin (for example 30720), with a failure message pointing at the limit. This costs one test and carries no risk.\n(b) Reorder renderAgentsMd so the Codex-operational sections come before the shared guidance. A truncation would then cut architecture prose instead of the workflow. This changes the AGENTS.md layout and breaks the section-order assertions in codex-artifact-validation.test.js.\n(c) Have `ndx init` write `project_doc_max_bytes` into .codex/config.toml. That pushes a per-machine setting onto users, so it is not recommended.\n\nBefore choosing, confirm the current Codex default for project_doc_max_bytes.\n\nTriage 2026-10-07: raised to high. Root AGENTS.md grew from 28,884 bytes at capture to 30,611 on main (2,157 bytes of headroom). Run together with fabfa3a2 before roadmap PR 24; a size-budget test should fail the build before Codex silently drops the tail."
lastModified: "2026-10-07T21:53:40.290Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
