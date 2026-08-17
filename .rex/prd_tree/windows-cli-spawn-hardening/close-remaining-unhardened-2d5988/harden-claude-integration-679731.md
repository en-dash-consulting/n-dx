---
id: "67973131-6101-470b-bd9d-1cb6a98698c4"
level: "task"
title: "Harden claude-integration execSync sites and make the DEP0190 guard self-maintaining"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "core"
  - "init"
  - "spawn"
  - "testing"
  - "architecture"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "All six claude-integration.js execSync sites route through win-spawn.js execFileSyncCli; no hand-built command strings remain"
  - "`ndx init` registers MCP servers successfully from a project path containing a space, an & character, and a trailing backslash"
  - "The guard discovers spawn sites by scanning rather than by a hardcoded file list — adding a new unhardened shell-string spawn anywhere fails the test without editing the guard first"
  - "Every existing intentional exemption is preserved as an explicit allowlist entry with a documented reason"
  - "TDD: the inverted guard is demonstrated RED against a deliberately-added unhardened spawn in a new file, then GREEN once hardened"
  - "Silent-failure note addressed: registration failures on affected paths surface to the user rather than being swallowed by the best-effort catch"
description: "TWO parts: fix the site, then fix the guard that should have caught it.\n\nPART 1 — packages/core/claude-integration.js. Six `execSync` calls build shell command strings by hand with bare `\"` quoting:\n- :201 `\"${claudeCmd}\" mcp remove --scope ${scope} ${name}`\n- :207-208 `\"${claudeCmd}\" mcp add ${name} -- node \"${bin}\" ${descriptor.mcpCommand} \"${absDir}\"`\n- :315, :328, :338, :348 — `\"${path}\" --version` discovery probes\n\n`absDir`, `claudeCmd`, and `bin` are all filesystem paths interpolated straight into a cmd.exe command line. A project directory containing `&`, `^`, `(`, `)`, or `!` splits the command (`C:\\Users\\Tom&Jerry\\proj` terminates at `&`); a trailing backslash turns the closing `\"` into an escaped quote and merges arguments. This is exactly the class task acf2fb32 fixed in the quoting twin — `ndx init` MCP registration simply never got routed through it. Route these through packages/core/win-spawn.js (execFileSyncCli), which already applies quoteWindowsToken/ArgvQuote rules. Note these are best-effort probes whose failure is caught and ignored — so the current bug manifests as *silent* registration failure on affected paths, not a visible error.\n\nPART 2 — the guard's blind spot. DEP0190_SCOPE (tests/e2e/architecture-policy.test.js:1668) is a hardcoded 11-file list. It has a stale-entry guard that fails when a listed file disappears, but NOTHING fails when a new file introduces an unhardened shell-string spawn. The ratchet only covers files someone remembered to enumerate — which is why claude-integration.js and export.js survived an entire Windows-hardening epic untouched.\n\nInvert it: scan the tree for spawn/exec/execSync/execFileSync call sites and fail on any that (a) pass a single command STRING rather than (binary, argv), or (b) use shell:true with non-empty args, unless the file appears in an explicit EXEMPT list with a stated reason. Discovery becomes automatic; exemption becomes the deliberate act. Preserve the existing documented exemptions (llm-client execShellCmd's intentional `sh -c`, pair-programming runShellTestCommand's empty-args shell:true, ci.js/pr-check.js pnpm spawns) as entries in the new exempt list rather than as gaps in coverage."
---
