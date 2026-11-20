---
id: "b50ad9a5-7f80-4051-a239-f3b647d0f64e"
type: "change"
title: "Preserve operator settings across Codex parity PR1 review edge cases"
slug: "preserve-operator-settings-across"
summary: "Keep operator settings and model choices intact when setup is repeated or the active vendor changes. Resolve four review findings without changing the later parity roadmap."
intent: "User requested checking and remediating PR #1050 review comments on 2026-11-19. Owning PR https://github.com/en-dash-consulting/n-dx/pull/1050 current reviewed head d5e1f90f795c8e042c56e003dfad9fd6e1a51198. Remediate only the four should-fix findings in review5978903350: config refusal blocks AGENTS/skills (discussion4631641506); owned MCP table refresh loses enabled/timeout and adjacent comments (4631641527); interactive Enter replaces off-catalog existing pin (4631641542); vendor switch erases the inactive vendor namespace pin (review body). Scope is the original PR1 preservation criteria, not later parity behavior. The four findings are directly authorized by the current user remediation request. Do not reopen the original completed tasks, add unrelated captures, restack descendants, merge, or enable auto-merge."
acceptanceCriteria:
  - "Valid operator MCP inline-table configs no longer prevent AGENTS.md/skills refresh on repeated init; either support safe inline tables or report config-only refusal while preserving existing config bytes and refreshing the other surfaces."
  - "Refreshing n-dx-owned MCP definitions preserves operator enabled/timeout/other extra settings and comments adjacent to following operator tables; never silently re-enable a disabled server. If an extra syntax cannot be safely merged, refuse it without data loss."
  - "Interactive re-init confirmation retains an existing off-catalog Codex model pin when no explicit model change was selected; explicit choices remain possible and deterministic."
  - "Switching llm.vendor or init provider between Codex and Claude preserves each vendor namespace model pin valid for its own vendor, including repeated switch-back, while genuinely incompatible namespace values are handled truthfully."
  - "Disposable regression tests reproduce the four failures, required cli-dev and scheduler-startup checks and affected gate pass, add a scoped @n-dx/core patch changeset, and complete through ndx work with fresh mandatory Codex self-review and atomic code/PRD commit."
touches:
  - "8eaa2e3d-abe4-42aa-89c9-226e9877f2b6"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "high"
discoveredFrom: {"item":"dd75c28b-2c8c-42a7-883f-27c103aea682"}
tags:
  - "pr-1050"
  - "codex-parity"
  - "review-remediation"
source: "pr-review"
---
