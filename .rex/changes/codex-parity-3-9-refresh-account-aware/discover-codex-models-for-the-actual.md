---
id: "d0f52798-2869-423b-af3f-788175f450fc"
type: "task"
title: "Discover Codex models for the actual account and selected CLI"
slug: "discover-codex-models-for-the-actual"
description: "Official account-aware model/effort discovery: https://learn.chatgpt.com/docs/app-server (model/list). The audit's app-server requests timed out on 0.164.0-alpha.11.1 and 0.167.0-alpha.3.2; it did not prove account availability.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Use the effective configured/trusted binary and account model catalog where the installed CLI supports it; never require an API key merely to discover a ChatGPT-login model."
  - "Distinguish public documentation, built-in fallback and account-observed availability; show version, provenance, checked time and actionable probe failures."
  - "Current CLI models are accepted consistently by dashboard pickers, saved run settings and CLI resolution; refresh invalidates stale account/config/binary cache entries."
  - "Unsupported or unavailable CLI versions and timed-out probes retain an honest fallback; do not claim account access from API catalog membership."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"PR3 scope/risk assessment: account- and trust-sensitive CLI discovery, async probe failure/provenance and cache invalidation across foundation/dashboard/saved run validation require heavy Astra; fixture tests plus actual installed-CLI observations can verify behavior, with no API/Claude fallback. Mandatory fresh heavy Astra self-review. Only this task, not defaults/effort/forks/recovery. Use checkout-local Rex; do not use original-bound desktop MCP. Official fresh documentation available at /private/tmp/ndx-parity-pr3-official-docs; model/list may be a client catalog, never inference entitlement proof. Required scoped checks, cli-dev/scheduler-startup, scoped patch changesets and .hench-commit-msg.txt sentinel; let Hench own completion and atomic commit. No subagents or parallel model runs; two-run global ceiling. Preserve Codex workspace-write and truthful sandbox markers. Disposable validation homes outside repo. No unapproved PRD capture."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-3"
source: "ndx-capture"
blockedBy:
  - "0c727192-938b-46d8-b068-2e7022139750"
---
