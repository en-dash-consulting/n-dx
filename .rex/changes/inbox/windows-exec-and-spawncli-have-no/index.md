---
id: "324e15a3-42c5-441f-95c4-46db8d984dd5"
type: "change"
title: "Windows: exec() and spawnCli have no windowsHide, so children of console-less parents open visible console windows and sv narrate's claude window never closes"
slug: "windows-exec-and-spawncli-have-no"
intent: "Severity: high (visible, recurring disruption on every Windows session; one window outlives its session). Reported by the operator on 2026-10-13 after the earlier windowsHide fix (core/win-spawn.js, spawnTool/spawnManaged defaults).\n\nMECHANISM\nlibuv maps `detached: true` to DETACHED_PROCESS and `windowsHide: true` to CREATE_NO_WINDOW; Windows ignores CREATE_NO_WINDOW when DETACHED_PROCESS is set. The hub (core/web.js:1237), the background dashboard (core/web.js:1874) and `sv narrate` (sourcevision/src/cli/commands/analyze.ts:278) are therefore console-less, and every child they spawn WITHOUT windowsHide allocates a brand-new visible console. The previous fix covered core's win-spawn.js and llm-client's spawnTool/spawnManaged, but not the two helpers most spawns go through:\n- packages/llm-client/src/exec.ts:263 `exec()` — ExecOptions has no windowsHide field. Used by ~100 sites: every git call in hench/web/rex/core, execShellCmd (cmd.exe /d /s /c \"<command>\" when no sh is on PATH), the dashboard's polled git reads (web/src/server/routes-git.ts:71, routes-project.ts:89, routes-worktrees.ts:221), the vendor --version probes (web/src/server/llm-catalog.ts:110), the prep run (routes-hench-prep.ts:162).\n- packages/llm-client/src/exec.ts:1701/1708 `spawnCli` — the claude/codex CLI spawn itself (hench cli-loop.ts:794, llm-client cli-provider.ts:146, codex-cli-provider.ts:269); SpawnCliOptions (exec.ts:1542) has no windowsHide.\n- packages/sourcevision/src/util/exec-cli.ts:29 (cmd.exe → rex), packages/core/pair-programming.js:891 (shell: true test command), packages/core/ci.js:140 (shell on win32), and the raw execFileSync git sites in sourcevision/rex/core.\n\nTHE WINDOW THAT NEVER CLOSES\n`sv narrate` is spawned detached and unref'd with its pid written to the manifest, and nothing ever terminates it; it runs the vendor CLI through spawnCli, which opens its own visible console for the whole narration. If narrate hangs or outlives the session, that console stays up until killed by hand.\n\nSOLUTIONS\n1 (recommended): add `windowsHide?: boolean` to ExecOptions and SpawnCliOptions, default true, applied at exec.ts:263 and exec.ts:1701/1708; mirror `windowsHide: true` into sourcevision's exec-cli.ts:29, core/pair-programming.js:891, core/ci.js:140 and the raw execFileSync git sites. Cost: small, mechanical; add a policy test (like the DEP0190 guard in the windows-cli-spawn-hardening feature) that fails on any spawn/exec/execFile call in src without windowsHide. Risk: a child that legitimately needs a console (none known; interactive flows run in the user's own terminal, which the flag does not affect).\n2 (additionally, for the lingering window): give `sv narrate` a lifetime — terminate it from analyze's completion path or on the next analyze, or register it with the child tracker — so an abandoned narration cannot outlive the session."
acceptanceCriteria:
  - "ExecOptions and SpawnCliOptions accept windowsHide and default it to true; exec() and spawnCli pass it to node:child_process"
  - "A policy test fails on any spawn/exec/execFile/execFileSync call under packages/*/src and packages/core/*.js that does not pass windowsHide (allow-list for the user-facing interactive spawns)"
  - "sourcevision exec-cli.ts, core/pair-programming.js:891, core/ci.js:140 pass windowsHide: true"
  - "On Windows, a dashboard session that polls git, probes vendor CLIs and runs an agent task opens no console window (manual verification noted in the PR)"
  - "sv narrate's vendor-CLI child opens no console window, and an abandoned narrate is terminated by the next analyze or at session end"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "windows"
  - "llm-client"
  - "sourcevision"
  - "core"
source: "ndx-adversarial-review"
---
