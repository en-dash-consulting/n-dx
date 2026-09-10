---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Make the full-suite gate's timeout configurable via `hench.fullTestTimeoutMs`.

It was hardcoded (5 minutes originally, raised to a measured 15 in the same
release this ships in). However generous the constant, a suite an operator
cannot re-budget will eventually exceed it — and overrunning
aborts a task whose work was already done and committed. Set the key in
`.hench/config.json` or `.n-dx.json` (the latter wins, as with every other
hench key); 0 disables the limit. `ndx config` documents it under a new
"Hench test-gate settings" section, alongside `hench.fullTestCommand`.

A timeout is now attributable like any other gate failure. It used to return
zero packages, so the caller counted zero failures and printed
`0/0 package(s) failed` for a run it was about to abort; the result now carries
a `workspace` entry naming the command, how long it was given, and the key that
moves it.
