---
id: "76a37b38-cf6a-460a-8d88-a31a9c9f6c65"
level: "task"
title: "Fake-CLI fixtures write .args into the repo root instead of a temp dir"
status: "pending"
priority: "medium"
tags:
  - "testing"
  - "hygiene"
  - "fixtures"
  - "cross-os"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "Fixture argument-capture files are written inside the test's temp directory via an absolute path, not relative to CWD"
  - "Both the cmd and sh shim branches are fixed"
  - "A full suite run leaves `git status --porcelain` clean — no .args file appears in the repo root"
  - "The `claude.args` entry is removed from .gitignore so any regression is visible rather than masked"
  - "Other fixtures using $0-relative or CWD-relative output paths are audited and fixed or confirmed safe"
description: "The fake-CLI shim builders write their argument capture to a path that resolves relative to the CWD, so the file lands in the repository working tree rather than the fixture's temp directory.\n\nSites:\n  tests/e2e/cli-init.test.js:19    `echo %* > \"%~f0.args\"`      (cmd branch)\n  tests/e2e/cli-init.test.js:27    `echo \"$@\" > \"$0.args\"`      (sh branch)\n  tests/e2e/cli-config.test.js:22  and :30 — same pair\n\nObserved result: a `claude.args` file appears in the repo root mid-run. Verified content, which confirms it is the `ndx init` MCP-registration path hitting the shim:\n\n  mcp add sourcevision -- node \"C:\\...\\packages\\sourcevision\\dist\\cli\\index.js\" mcp \"C:\\...\\Temp\ndx-init-e2e-U7vwGR\"\n\nThe file is named `claude.args` (not `<abs-path-to-shim>.cmd.args`), which is the tell: when the shim is invoked by bare name, `$0` / `%~f0` is the bare name, so `$0.args` is written into whatever CWD the invoking process had — here the repo root.\n\nCurrently MASKED, not fixed: `.gitignore:55` carries a `claude.args` entry. A prior task also deleted `claude.args`/`codex.args` from the repo root as \"unreferenced smoke fixtures\" and they simply regenerated, because the write path was never changed.\n\nFix: give the shim an absolute capture path instead of relying on `$0`/`%~f0` resolution — pass the target via an env var the builder bakes in (e.g. an `NDX_TEST_ARGS_FILE` pointing inside the test's temp dir) and have the tests read it from there. Both the cmd and sh branches need it, since which one runs depends on the platform and on how the shim gets invoked. Then remove the `.gitignore:55` entry so a regression becomes visible in `git status` instead of being silently swallowed again.\n\nCheck for siblings while in here: any other fixture using `$0`-relative or CWD-relative output paths has the same latent bug."
---
