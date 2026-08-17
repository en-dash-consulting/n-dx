---
id: "2d5988dc-74a2-4723-8234-0f7a8b7becfc"
level: "feature"
title: "Close remaining unhardened shell-string spawn sites"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "spawn"
  - "quoting"
  - "core"
  - "gh:37"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "No production spawn/exec site builds a Windows command line by hand — all route through win-spawn.js / spawnCli / execFileSyncCli"
  - "The DEP0190 guard fails when a new file introduces an unhardened shell-string spawn, without that file needing to be manually enumerated first"
  - "`ndx init` and `ndx export` both work from a project path containing spaces, `&`, and a trailing backslash"
  - "Intentional exemptions remain explicitly allowlisted with a documented reason, not silently unscanned"
description: "This epic routed the four known CLI spawn sites (plus pair-programming.js and sourcevision's rex spawns) through spawnCli/execFileSyncCli, and locked the fix with the DEP0190 guard in tests/e2e/architecture-policy.test.js. Two files were missed, and the guard's design means it could not have caught them.\n\nMISSED SITES (both use `execSync` with hand-built shell command strings, quoted with bare `\"` and no quoteWindowsToken/ArgvQuote treatment):\n- packages/core/claude-integration.js:201,207 — `ndx init` MCP registration (`claude mcp remove/add`), plus binary discovery at 315, 328, 338, 348\n- packages/core/export.js — 20+ git/rex/rm invocations across `ndx export`, including POSIX-only shell syntax that cannot work under cmd.exe\n\nSTRUCTURAL CAUSE: DEP0190_SCOPE (architecture-policy.test.js:1668) is a hardcoded 11-file list. It has a stale-entry guard (fails if a listed file disappears) but nothing that fails when a NEW file introduces a shell-string spawn without being added. The guard therefore ratchets only over files someone remembered to enumerate — the exact failure mode that let these two persist through a whole hardening epic. Fixing the two sites without fixing the guard's blind spot leaves the next site equally unprotected."
---

## Children

| Title | Status |
|-------|--------|
| [Harden claude-integration execSync sites and make the DEP0190 guard self-maintaining](./harden-claude-integration-679731.md) | pending |
| [Make ndx export --deploy=github work on Windows (rm -rf and POSIX shell syntax)](./make-ndx-export-deploy-github-c990fd.md) | pending |
