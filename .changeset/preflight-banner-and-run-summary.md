---
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

Show what `ndx analyze`, `ndx plan` and `ndx recommend` are about to do, and what they did

Run interactively, these three now print a preflight banner before they start:
what the command reads, what it writes (and which writes need `--accept`),
which phases call a model and why, and roughly how long it takes. It pauses
briefly so you can Ctrl-C, then prints a closing summary of the files written,
the LLM calls and tokens, the cost, and the command to run next.

`ndx recommend` is declared as making no model calls at all, because it groups
SourceVision findings deterministically — knowing which commands are free is
the point of the banner as much as knowing which are not.

The banner is skipped under `--yes`, `--quiet` and `--format=json`, in CI, and
whenever stdout is not a terminal — so autonomous `ndx work` runs and piped
invocations are unaffected. Both the banner and the summary go to stderr, so
`--format=json` stdout is byte-identical either way. `NDX_PREFLIGHT=always`
forces the banner when piping; `NDX_PREFLIGHT_PAUSE_MS` sets the pause.

Supporting changes:

- `rex analyze` and `rex recommend` now run under the shared monotonic progress
  reporter from `@n-dx/llm-client`, and rex's spinner registers with it like
  sourcevision's already did — so a rate-limit retry raised inside an LLM call
  pauses the spinner and prints its own line instead of corrupting it.
- Cost is recorded by the tool that spends it, never recomputed by a reader:
  `sv analyze` writes `lastAnalysis.llm.costUsd` to the manifest (additive,
  optional), priced per task class at the model that answered; `rex analyze`
  adds `costUsd` to its `analyze_token_usage` log entry. The orchestrator
  cannot import the price table, and a second copy of it would drift — so where
  no cost was recorded the summary says "not recorded" rather than guessing.
