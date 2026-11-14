---
id: "2331ee7c-5a4b-488e-8cab-82d4fe1506dc"
type: "change"
title: "Codex parity 3/9: refresh account-aware catalogs and unpinned defaults"
slug: "codex-parity-3-9-refresh-account-aware"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 3 of 9 (stack position 4 of 10).\n\nRoadmap 5. Audit sources: core/llm-model-catalog.js, llm-client/config.ts, vendor-model-list.ts and web/routes-llm.ts:1079 plus routes-hench-prep.ts. Built-in models/defaults remained GPT-5.6; dashboard saved run pins could reject current CLI models without an API key. Cross-reference completed 74f09a9f-fdf1-4b2a-a272-53bc202d0a91 and af64cc0d-b523-4304-8db2-5cb3388b238d as predecessor work, not unfinished duplicates."
acceptanceCriteria:
  - "Discover Codex models for the actual account and selected CLI: Use the effective configured/trusted binary and account model catalog where the installed CLI supports it; never require an API key merely to discover a ChatGPT-login model."
  - "Discover Codex models for the actual account and selected CLI: Distinguish public documentation, built-in fallback and account-observed availability; show version, provenance, checked time and actionable probe failures."
  - "Discover Codex models for the actual account and selected CLI: Current CLI models are accepted consistently by dashboard pickers, saved run settings and CLI resolution; refresh invalidates stale account/config/binary cache entries."
  - "Discover Codex models for the actual account and selected CLI: Unsupported or unavailable CLI versions and timed-out probes retain an honest fallback; do not claim account access from API catalog membership."
  - "Refresh unpinned Codex tiers, reviewers and init templates: Update unpinned execution tiers, reviewer defaults, init catalogs/templates, fallback defaults, help/examples and dashboard metadata consistently using then-current verified availability."
  - "Refresh unpinned Codex tiers, reviewers and init templates: Preserve every explicit llm, tier, hench, task and review pin; no automatic rewrite of saved user settings."
  - "Refresh unpinned Codex tiers, reviewers and init templates: Treat retired ChatGPT-only models separately from still-supported API models; retained API pins remain usable and labeled honestly."
  - "Refresh unpinned Codex tiers, reviewers and init templates: Effort recommendations are applied only once Codex effort plumbing is implemented and supported; otherwise leave client defaults and state the limitation."
  - "Refresh unpinned Codex tiers, reviewers and init templates: Add contract coverage for runtime/catalog/template agreement and the ordinary/explicit-pin upgrade paths."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "405c9fcf-2258-472f-8eb7-30d5b7ae0b8a"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
  - "8eaa2e3d-abe4-42aa-89c9-226e9877f2b6"
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-3"
  - "stack-position-4-of-10"
source: "ndx-capture"
blockedBy:
  - "0c727192-938b-46d8-b068-2e7022139750"
---
