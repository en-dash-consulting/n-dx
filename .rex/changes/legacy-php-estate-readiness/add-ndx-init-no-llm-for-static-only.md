---
id: "4e33c0c3-8233-4480-92eb-d1d74a089ed8"
type: "task"
title: "Add ndx init --no-llm for static-only batch initialization"
slug: "add-ndx-init-no-llm-for-static-only"
summary: "Let a repository be set up for n-dx without any AI call or AI login check, so many repositories can be initialized in a batch with nothing sent off the machine."
description: "**Problem.** `ndx init` always spawns `claude --version` and a live auth probe, `claude -p \"Reply with exactly: ok\" --output-format json` (`vendorAuthPreflightArgs` / `runVendorAuthPreflight` in `packages/core/config.js`), and logs both to `claude_commands.log` at the project root. A batch init over many repositories must be static-only. `ndx plan` already maps `--no-llm` to `--fast`; init has no such flag. Init's own analyze already passes `--fast` (`packages/core/cli.js`, `runInitCapture(tools.sourcevision, [\"analyze\", \"--fast\", …])`).\n\nRequirement from the engagement (2026-11-16): the batch wrapper calls `ndx init --no-llm`, so the flag must be named exactly that, matching `ndx plan --no-llm`. If anything else in init needs the network or a model (hench init, assistant provisioning, MCP registration, trust, the update check), `--no-llm` skips it and prints one line saying what was skipped.

**Fix.** Add `ndx init --no-llm`:\n- no vendor auth probe, no `--version` call, no other vendor-CLI or model spawn, no network request from init itself (the npm update check is already off with `--quiet`; say in the help whether `--no-llm` also turns it off, and make it do so);\n- no `claude_commands.log` written;\n- init's analyze runs with `--fast` (and, after the `--fast` task in this change, therefore with judgment off);\n- the provider/model configuration is still written as with `--provider` (it does not need a working model);\n- the summary prints one clear line: model features were not checked (`--no-llm`), and names the command that checks them later (the existing preflight/doctor command, if there is one);\n- `ndx init --help` documents the flag, and the orchestrator flag tables/effects declarations stay consistent (check `command-effects` and the help tests).\n\n**Tests:** a core CLI test runs `ndx init --no-llm --provider=claude --no-commit --git` in a temp directory with a fake `claude` on `PATH` that records its arguments, and asserts the fake was never called, no `claude_commands.log` exists, the summary line is printed, and the exit code is 0. Existing init tests pass unchanged."
acceptanceCriteria:
  - "ndx init --no-llm spawns no vendor CLI and makes no model or network call"
  - "No claude_commands.log is written"
  - "The summary says model features were not checked"
  - "ndx init --help documents --no-llm"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "core"
  - "privacy"
  - "estate-readiness"
  - "php-pr12"
blockedBy:
  - "7bb107a8-6831-44c8-9dc8-4a1cc51ffa70"
---
