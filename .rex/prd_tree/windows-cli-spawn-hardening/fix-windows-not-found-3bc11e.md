---
id: "3bc11e6e-5112-49fd-a638-ee73aa520c17"
level: "task"
title: "Fix Windows not-found diagnostics: hench close-path detection, pattern anchoring, absolute-path diagnosis, codex stdin guard"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "llm-client"
  - "hench"
  - "gh:68"
  - "audit-remediation"
blockedBy:
  - "6b7def28-de13-4a56-a8d0-d0eae3833983"
source: "fable-audit-2026-07-10"
acceptanceCriteria:
  - "TDD: failing tests first for (a) hench close-path not-found detection, (b) anchored pattern NOT matching generic task stderr, (c) absolute-path diagnosis both branches, (d) codex stdin error handler presence"
  - "hench cli-loop close/non-zero path routes Windows 'is not recognized' stderr through diagnoseCliInvocation with the vendor config key"
  - "NOT_FOUND_PATTERNS lives once in exec.ts, anchored to the binary name; original stderr detail is never dropped from errors/logs"
  - "diagnoseCliInvocation handles absolute paths via existsSync with accurate messages and sane fix hints (no '/path/to/C:\\...' nesting); stale 'not directly invokable' wording replaced"
  - "codex-cli-provider stdin has the same no-op error guard as cli-provider"
  - "All existing provider/cli-loop tests green"
description: "Four related diagnostic-quality fixes from the audit. (1) HENCH CLOSE-PATH: under spawnCli on win32, a missing vendor CLI never fires ENOENT — cmd.exe spawns fine and exits non-zero with \"'X' is not recognized...\" on stderr. hench cli-loop.ts only wired diagnoseCliInvocation into the ENOENT error handler (dead code on win32); add a NOT_FOUND detection in the close/non-zero-exit path (like cli-provider.ts:218 and codex-cli-provider.ts:263 do) so Windows users get the actionable message on the highest-traffic site. (2) DEDUP + ANCHOR THE PATTERNS: NOT_FOUND_PATTERNS is duplicated verbatim in cli-provider.ts:42 and codex-cli-provider.ts:36 — move it to exec.ts (single export next to diagnoseCliInvocation), and ANCHOR the match to the spawned binary name (e.g. build the regex from the binary: '<binary>' is not recognized / cannot find) so a legitimate run whose stderr echoes generic Windows errors from its OWN work (e.g. \"The system cannot find the file specified\" from a task subcommand) is NOT misclassified as CLI-not-found; when the pattern does not match, preserve the existing classifyStderr flow and NEVER drop the original detail — include or log the raw stderr alongside any diagnosis. (3) ABSOLUTE-PATH DIAGNOSIS: resolveExecutablePath uses `where`, which errors ('Invalid pattern') on absolute paths — diagnoseCliInvocation therefore misdiagnoses a configured absolute cli_path as \"not found on PATH\" with a garbled '/path/to/C:\\\\...' hint. Add an absolute-path branch: if path.isAbsolute(binary), check existsSync — exists → message about the file existing but failing to run (suggest checking it is a valid executable/shim); missing → \"configured path does not exist: <path> — check n-dx config <configKey>\". Also modernize the on-PATH message: spawnCli already handles .cmd shims and spaced paths, so drop the stale \"not directly invokable (.cmd shim or path containing spaces)\" text in favor of likely real causes (exit-status/PATH-env mismatch, broken shim). (4) CODEX STDIN GUARD: codex-cli-provider.ts:219 writes the prompt to stdin with no 'error' handler (cli-provider.ts:145 has a no-op one) — an EPIPE from a fast-exiting cmd.exe can crash the process before the friendly diagnosis; add the same no-op stdin error handler. Also, in cli-loop's ENOENT handler, append diagnosis.message only when it adds information (onPath true or absolute-path case) to stop stacking redundant install hints. TDD throughout: failing tests first for each of the four behaviors."
---
