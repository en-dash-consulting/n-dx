---
id: "46d8b92f-cc15-438a-84e0-9bac61a9adc7"
level: "task"
title: "`ndx add` ignores configured Google/Gemini vendor and falls back to Claude"
status: "completed"
priority: "high"
tags:
  - "bug"
  - "google-integration"
  - "llm"
  - "cli"
source: "skill/ndx-capture"
startedAt: "2026-06-09T13:52:38.182Z"
completedAt: "2026-06-09T14:02:44.904Z"
endedAt: "2026-06-09T14:02:44.904Z"
resolutionType: "code-change"
resolutionDetail: "Added two Google vendor regression tests to smart-add-vendor-model-selection.test.ts. The config reading path was already correct via the dirname() adapter in rex/store/project-config.ts — the bug described in the task was pre-fixed. Tests confirm vendor=google correctly resolves to gemini-2.5-flash (standard tier) or a configured llm.google.model."
acceptanceCriteria:
  - "`ndx init --provider=google` persists `llm.vendor: \"google\"` (and a `llm.google` model block) to the project config that `ndx add` reads."
  - "After Google init, `ndx add \"...\"` prints `Vendor: google` and routes the description-analysis LLM call to Gemini, not Claude."
  - "The vendor-resolution path no longer silently defaults to `\"claude\"` when a non-Claude vendor is configured; it surfaces a clear error if no vendor is resolvable."
  - "A regression test covers the Google vendor in `smart-add-vendor-model-selection.test.ts` (currently only Claude and Codex are covered)."
description: "After running `ndx init --provider=google` to configure the Google (Gemini) vendor, `ndx add \"...\"` still prints `Vendor: claude  Model: claude-sonnet-4-6 (default)` and uses Claude for description analysis instead of Gemini. The smart-add LLM init (`initializeSmartAddLLM`, `packages/rex/src/cli/commands/smart-add.ts:1146`) resolves config from the `.rex/` dir via `loadLLMConfig(rexConfigDir)`, but the vendor selected by `ndx init` is persisted to `.n-dx.json` at the project root, so the vendor reads as unset and `resolveVendor()` (`packages/rex/src/analyze/llm-bridge.ts:45`) defaults to `\"claude\"`. Need to confirm whether `ndx init --provider=google` actually writes `llm.vendor: \"google\"` and a `llm.google` block, and ensure `ndx add` reads the same config source. Part of the `feat/google-integration` work."
---
