---
"@n-dx/hench": patch
---

The completion commit's staged paths and the gate's discounted paths derive from one definition, and a tracked execution log is reported, not silently left dirty

The two sets drifted twice while maintained by hand: `tree-meta.json` was
once staged by nobody and discounted by nobody (every completion refused),
then the execution log was staged by nobody but still discounted — so in a
project that tracks `.rex/execution-log.jsonl` (created before `rex init`
gitignored the pattern), every completion left it modified and the next
autonomous run's pre-run gate refused to start.

Both sets now derive from a single `PRD_WRITE_PATHS` definition that also
records who commits each path, with a test that fails on the next drift in
either direction. Hench no longer stages the execution log at all (0.7.0 did); after a
completion commit it now checks for dirty operator-owned PRD writes and
prints whose they are — commit the log yourself, or gitignore it as `rex
init` does. A gitignored log is, as before, neither staged nor reported.
