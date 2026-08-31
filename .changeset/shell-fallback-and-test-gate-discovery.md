---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Run the mandatory test gate on Windows, and stop it skipping itself silently

`execShellCmd` was hard-coded to `sh -c`. `sh` ships with Git for Windows and is
absent from a stock Windows PATH, so `spawn` failed `ENOENT` — and because
`exec` resolves rather than rejects, every caller reading only `stdout` saw an
empty string. A shell that never launched was indistinguishable from a command
that printed nothing.

That ambiguity is what let the mandatory pre-commit test suite gate skip itself
three times with "No files modified in prior phases", on runs that shipped
source and tests. Its git discovery ran through that shell, found nothing,
concluded nothing had changed, and the `catch` meant to notice never fired
because nothing threw.

- `execShellCmd` now prefers `sh` wherever it resolves and falls back to
  `cmd.exe /d /s /c` on win32 when it does not. Every platform that already had
  a working shell is unaffected; only the case that could not work at all
  changes. Exposed as `resolveShellInvocation` for direct testing.
- The gate's changed-file discovery moved to `discoverChangedFiles`, which asks
  git via argv rather than through a shell — none of those queries needs one —
  and returns `{ files, failed, failures }` so "could not look" is a distinct
  state from "looked, found nothing".
- `runTestGate` takes `filesChangedKnown`. An empty file set that could not be
  verified now runs the suite instead of skipping it: the mandatory gate fails
  closed.
- `buildRunSummary` recognises the Claude CLI's tool names (`Write`, `Edit`,
  `MultiEdit`, `NotebookEdit`, `Read`, `Bash`, keyed on `file_path`). It knew
  hench's and Codex's but not the CLI provider's, which is the default
  `ndx work` path — so `filesRead`, `commandsExecuted` and `testsRun` were zero
  on ordinary runs.

The previous regression tests for this could not have caught it: they ran git
themselves via `execFileSync`, built the file list by hand, and passed it to
`runTestGate`, never touching the code that connects the two. The new ones call
`discoverChangedFiles` directly.
