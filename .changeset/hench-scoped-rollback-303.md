---
"@n-dx/hench": patch
---

fix(hench): scope failure rollback to agent-created files and honor `--no-rollback` on review rejection (#303)

Rollback on run failure previously ran a blanket `git clean -fd`, deleting **every** untracked file in the working tree — including the user's pre-existing scratch, `.env`, and other hidden files that git had never tracked and could not recover. It also reverted unconditionally when a reviewer rejected changes, ignoring the `--no-rollback` flag entirely.

`revertChanges` now captures a baseline of untracked files before the agent runs (`captureBaselineUntracked`, mirroring `captureStartingHead`) and removes **only** the untracked files the agent created during that run, via a scoped `git clean -fd -- <paths>`. Pre-existing untracked files are never touched. When no baseline is available it deletes nothing (safe fallback). Tracked-file changes are still reverted via `git reset` + `git checkout` (recoverable from history). The review-rejection path now honors `rollbackOnFailure`/`--no-rollback` and reuses the same interactive confirmation prompt as the failure path. The baseline is threaded through both the API/Gemini (`loop.ts`) and CLI (`cli-loop.ts`) run loops.
