---
id: "dd75c28b-2c8c-42a7-883f-27c103aea682"
type: "change"
title: "Codex parity 1/9: preserve configuration and intentional model pins"
slug: "codex-parity-1-9-preserve"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 1 of 9 (stack position 2 of 10).\n\nRoadmap 3a and 3b. Audit sources: packages/core/codex-integration.js:46-53 overwrites project config.toml; packages/llm-client/src/config.ts:130 and llm-config.ts:182 normalize API-valid Codex pins without considering auth. Preserve operator intent across re-init, config loading and model upgrades."
acceptanceCriteria:
  - "Preserve operator Codex settings during ndx init: Re-init retains intentional project model pins, unrelated tables and operator MCP entries while updating n-dx-owned definitions."
  - "Preserve operator Codex settings during ndx init: Fresh init and repeated init are deterministic; unreadable or ambiguous config fails without data loss."
  - "Preserve operator Codex settings during ndx init: Regression coverage uses a disposable existing config; Claude setup behavior stays unchanged."
  - "Keep authentication-valid Codex model pins literal: API-supported IDs remain literal in configuration and execution, including intentional older pins."
  - "Keep authentication-valid Codex model pins literal: Unavailable ChatGPT-authenticated models produce actionable diagnostics and an explicit migration choice rather than silent substitution."
  - "Keep authentication-valid Codex model pins literal: Preserve llm, tier, hench, task execution and review pins; changing defaults never rewrites them."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "8eaa2e3d-abe4-42aa-89c9-226e9877f2b6"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-1"
  - "stack-position-2-of-10"
source: "ndx-capture"
blockedBy:
  - "2337bb92-a7bc-4e91-a886-e727b1a182a3"
---
