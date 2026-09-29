---
id: "eaa62be5-cd00-4968-b9bc-99c0ab8f8288"
level: "feature"
title: "Command transparency"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "command-transparency"
source: "caos work management: feature ndx 0.8.0 - Command transparency"
acceptanceCriteria:
  - "Every command in the manifest has an effects declaration, and docs/cli-ui-gap.md regenerated from it shows no command without one."
  - "ndx analyze without --yes prints the banner and pauses; with --yes or in autonomous mode it does not; --format=json output is unchanged."
  - "Every token-spending dashboard route enforces its feature gate server-side, not only in the nav."
  - "One job tray shows every async job across Commands, Overview and Suggestions, each with a working Stop."
  - "Terminal-only commands appear as labelled rows, not buttons."
  - "Plan and recommend report progress through the same reporter analyze uses."
description: "Extend the command manifest already served at /api/commands/manifest so every command declares its effects once: what it reads, what it writes (analysis output, PRD tree, source files, or nothing), which phases call an LLM with which model and roughly how many calls, what network it touches, and a duration hint. The source of truth lives in core beside the help registry so the CLI and the server read the same object. In the terminal, interactive analyze, plan and recommend show a preflight banner and pause briefly, skipped by --yes and in autonomous modes, then print monotonic progress and a summary of files written, LLM calls, tokens, cost and the next command. In the dashboard, the same declaration appears as a preflight card with Run and Cancel, every async job runs through one shared tray with phase, elapsed and Stop (replacing the per-view pollers), a result card links to what was produced, and Run buttons are added for status, next, tree, report, verify, prd export, prd import, an auth re-check and a confirm-gated sourcevision reset. Commands that stay terminal-only (init, start, dev, pair-programming, bicker) say so in their row instead of showing an inert button.\n\n0.7.1 shipped the terminal groundwork (#414): a shared monotonic progress reporter in llm-client, with each retry printed as its own retry n/m line, used today by analyze. Plan and recommend should report through the same reporter rather than a second one. A 2026-09-24 audit traced every CLI, MCP, skill and dashboard surface; its per-command reads, writes and LLM calls are the starting data for the effects declarations.\n\nGoal: Before any command runs, in either surface, the user knows whether it is read-only, what it will spend and why."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add dashboard preflight cards, new Run buttons and labelled terminal-only rows on Commands](./add-dashboard-preflight-cards-new-run.md) | pending |
| [Declare each command's effects in the core command manifest and regenerate cli-ui-gap.md from it](./declare-each-command-s-effects-in-the.md) | pending |
| [Enforce feature gates server-side on every token-spending dashboard route](./enforce-feature-gates-server-side-on.md) | pending |
| [Print a preflight banner before interactive analyze, plan and recommend and a run summary after](./print-a-preflight-banner-before.md) | pending |
| [Run every async dashboard job through one shared job tray with phase, elapsed and Stop](./run-every-async-dashboard-job-through.md) | completed |
