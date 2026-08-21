---
"@n-dx/core": patch
---

Scope every skill's run record to the skill's own work.

`/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, and `/ndx-config` all ended with
`ndx hench record` but never captured a start time, so none could pass
`--startedAt`. Without it the first record in a session has no watermark to work
back from: `readUsageDelta` opens its window at the top of the transcript and the
record claims every token the session spent before the skill was invoked. A
`/ndx-capture` run measured while fixing this claimed 21,343,032 tokens across
171 messages — an entire session's unrelated work charged to one captured item.

Each of the four now notes the current time in ISO-8601 before it starts and
passes it as `--startedAt`. `/ndx-work` already did, but prescribed `date -Is`,
which does not exist in PowerShell; it and the four new instructions name both
`date -Is` and `Get-Date -Format o` as examples of whatever the shell provides.

A new test, `tests/e2e/skill-run-recording.test.js`, derives its skill list from
the manifest rather than hardcoding it, so a future skill that records runs is
covered the moment it is added: it must pass `--startedAt`, say where the value
comes from, and not prescribe a POSIX-only command to get it.
