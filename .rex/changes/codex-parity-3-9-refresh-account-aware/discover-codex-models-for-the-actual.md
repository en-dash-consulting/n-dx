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
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-3"
source: "ndx-capture"
blockedBy:
  - "0c727192-938b-46d8-b068-2e7022139750"
---
