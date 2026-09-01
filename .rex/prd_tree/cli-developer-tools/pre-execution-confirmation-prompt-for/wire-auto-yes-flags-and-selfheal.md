---
id: "1c9a9160-e4fb-4e27-96b1-c0cdf0a9830c"
level: "task"
title: "Wire --auto/--yes flags and selfHeal.autoConfirm config to bypass the prompt"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "self-heal"
  - "config"
source: "smart-add"
startedAt: "2026-05-11T15:44:14.887Z"
completedAt: "2026-05-11T15:54:34.456Z"
endedAt: "2026-05-11T15:54:34.456Z"
resolutionType: "code-change"
resolutionDetail: "Added selfHeal.autoConfirm to .n-dx.json schema (PROJECT_SECTIONS + validator), documented precedence in help.js and config HELP_TEXT, and added regression coverage for flag-only / config-only / both / neither against the prompt gate plus a config CLI surface e2e suite."
acceptanceCriteria:
  - "`ndx self-heal --auto` (and --yes if currently supported by self-heal) skips the confirmation prompt and runs end-to-end without stdin interaction"
  - "Setting `selfHeal.autoConfirm=true` via `ndx config` or `.n-dx.json` skips the prompt for all subsequent self-heal invocations"
  - "CLI flag takes precedence over config when both are present (flag=true overrides config=false and vice versa)"
  - "`ndx self-heal --help` and the config schema documentation describe the new flag/setting and their interaction"
  - "Regression tests cover flag-only, config-only, both-set, and neither-set cases against the prompt gate"
description: "Extend the self-heal CLI argument parser to recognize an auto-confirm flag (reusing the existing --auto/--yes convention used elsewhere in ndx where applicable) and add a `selfHeal.autoConfirm` boolean to the `.n-dx.json` schema and `ndx config` surface. When either signal is present, skip the confirmation prompt entirely so scheduled and CI-driven self-heal runs remain non-interactive. Document the precedence (CLI flag overrides config) and update help text."
---
