---
"@n-dx/hench": patch
---

A task whose only change is `.rex/workflow.md` or `.rex/config.json` can
complete through `ndx work` again.

Before the test gate, hench asks whether a run changed anything. That question
was answered by three directory prefixes — `.rex/`, `.hench/` and `.ndx/` —
and everything beneath one of them was bookkeeping. But not everything under
`.rex/` is: `workflow.md` goes into every agent brief and `config.json` is
project configuration. A run that edited only those read as "no changes", so
the gate never ran and the completion check rejected the claim — permanently,
since nothing the agent could do would produce a change the gate could see
(#539). The `.ndx/` entry had the same effect on the container layout.

The blanket prefixes are now an explicit list: all of hench's own state, plus
rex's own records — `prd_tree/`, `.cache/`, `execution-log.jsonl` and its
rotation, `tree-meta.json`, `archive.json`, `pending-proposals.json` and
`acknowledged-findings.json`. Everything else under `.rex/` or the container
counts as the run's work. The list is spelled for both layouts through the
layout resolver, and the changed-file gate, the reviewer's repaired-files
filter and the completion diff summary are all built from it, so the three
cannot disagree about what counts as work.

One behaviour follows from the narrowing rather than being aimed at: analysis
output under `.ndx/sourcevision/` now counts as a change, as `.sourcevision/`
always did on the legacy layout. The two layouts had disagreed about an
otherwise identical run.
