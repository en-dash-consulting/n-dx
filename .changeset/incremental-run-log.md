---
"@n-dx/hench": patch
---

Write the run log while the run is in progress, and record its path on the run.

`.run-logs/<ts>-<runId>.log` was assembled from an in-memory buffer and written
once, at run end. Nothing could watch a run as it happened, and a run that was
killed mid-way left no log at all — the buffer went with the process.

`openRunLog` now opens the file at run start and streams each captured output
line through to it as it is emitted, so the log can be tailed live and a crash
leaves a readable partial file. `RunRecord` gains an additive `logPath` so a
reader does not have to reconstruct the timestamped filename; records written
before it load unchanged.

The artifact is unchanged: the incremental writer and the end-of-run writer
produce byte-identical files for the same lines, pinned by a regression test.
The end-of-run writer is still used as the fallback — for a run started without
a project directory, and for one whose stream broke part-way, which is rewritten
whole from the buffer. Writes are never awaited on the agent loop's path, and a
log failure still cannot fail a run.

Writing the log early moves `.run-logs/` into the window the run's own gates
inspect, so two things move with it: `.run-logs/` joins hench's runtime-artifact
discount list (`store/artifacts.ts`), and the `.gitignore` entry is still added
at the end of the run rather than the start — editing a tracked file mid-run is
what the discount list exists to stop mattering. Without both, the first run in
a project that has not got the ignore line refuses to complete over a directory
it created itself.
