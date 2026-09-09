---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Make the full-suite gate's timeout configurable via `hench.fullTestTimeoutMs`.

It was hardcoded at 5 minutes. A monorepo that runs every package can
legitimately exceed that — this repo's own suite measures ~235s, leaving about
a minute of headroom on a machine an agent is also using — and overrunning
aborts a task whose work was already done and committed. Set the key in
`.hench/config.json` or `.n-dx.json` (the latter wins, as with every other
hench key); 0 disables the limit. `ndx config` documents it under a new
"Hench test-gate settings" section, alongside `hench.fullTestCommand`.

A timeout is now attributable like any other gate failure. It used to return
zero packages, so the caller counted zero failures and printed
`0/0 package(s) failed` for a run it was about to abort; the result now carries
a `workspace` entry naming the command, how long it was given, and the key that
moves it.
