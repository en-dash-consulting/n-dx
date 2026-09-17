---
"@n-dx/web": patch
---

The static run detail now says why a failed run has no error text.

`ndx export` strips `error` from both the per-run file and the `runs.json`
index unless `--include-transcripts` is passed — an error body can echo
whatever the agent read. The run detail rendered the Error section only when
`run.error` was present, so an exported failed run showed a "Failed" badge and
nothing else, indistinguishable from a run that failed for no recorded reason.

`runErrorDisplay` now decides that section's contents: the failure body when the
record carries one, otherwise a neutral notice for a failed run stamped
`transcriptOmitted`, naming the flag that would have published the text. The
Task Audit log viewer already did this for tool calls; the runs view now
matches.
