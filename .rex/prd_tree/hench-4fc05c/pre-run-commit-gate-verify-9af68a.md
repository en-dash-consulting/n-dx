---
id: "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
level: "feature"
title: "Pre-run commit gate: verify uncommitted changes before starting a work loop"
status: "completed"
priority: "medium"
startedAt: "2026-07-02T18:37:24.613Z"
completedAt: "2026-07-02T18:43:21.422Z"
endedAt: "2026-07-02T18:43:21.422Z"
acceptanceCriteria: []
description: "When `ndx work` / `hench run` starts, run a one-time git check (once per command invocation, immediately after start — not per iteration). If the working tree is dirty, show the diff summary and an LLM-proposed commit message, then prompt with three choices: **commit** the pre-existing changes now with the proposed message and proceed, **stop** before running, or **proceed** as normal leaving changes uncommitted. After this initial check, loop iterations run unchanged.\n\nReuse existing hench plumbing (`listDirtyPaths`, `collectReviewDiff`, `askYesNoWithSuspendedSigint`, `LLMProvider.complete`, `buildCoAuthoredByTrailerLine` + N-DX trailer block). Hook once-per-invocation in `cmdRun` (packages/hench/src/cli/commands/run.ts ~L1129, before dispatch L1146).\n\nAcceptance criteria:\n- Dirty tree → single prompt before any iteration, showing a diff summary + proposed commit message and 3 options (commit / stop / proceed).\n- \"commit\" → stages & commits pre-existing changes with the proposed message using the standard N-DX audit trailers, then starts the run.\n- \"stop\" → exits before any iteration runs.\n- \"proceed\" → starts the run with changes left uncommitted.\n- Clean tree → run starts immediately, no prompt.\n- Check runs exactly once per command, never per loop iteration.\n- Non-interactive / autonomous runs (no TTY, or --yes/--auto/--loop/--epic-by-epic) default to \"proceed as normal\" so unattended loops are never blocked.\n- No duplicated git/prompt/LLM/trailer logic — existing helpers reused."
---
