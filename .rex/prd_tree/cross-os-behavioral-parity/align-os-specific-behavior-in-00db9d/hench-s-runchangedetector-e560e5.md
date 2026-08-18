---
id: "e560e58d-5ad3-4546-b438-b8ce3c4996b7"
level: "task"
title: "hench's RunChangeDetector shares the mtime-granularity blind spot"
status: "pending"
priority: "medium"
tags:
  - "cross-os"
  - "windows"
  - "hench"
  - "correctness"
acceptanceCriteria:
  - "A same-size, same-mtime rewrite of a run file is detected by RunChangeDetector, proven by a test that pins mtime with utimes rather than relying on the host's timer resolution"
  - "The steady state remains stat-only — files are not hashed on every scan once their mtime is trustworthy"
  - "A recorded decision on whether the web and hench implementations share a helper or stay documented twins"
  - "The same tests pass on POSIX"
description: "The same defect just fixed in web's IncrementalTaskUsageAggregator (8f4878b4) exists unchanged in hench's RunChangeDetector — the web module's own docblock names it as the source of the strategy:\n\n  packages/hench/src/**/run-change-detector.ts\n    :144  } else if (prev.mtimeMs !== snapshot.mtimeMs || prev.size !== snapshot.size) {\n    :221  return { file, snapshot: { mtimeMs: st.mtimeMs, size: st.size } };\n\nA rewrite of the same LENGTH inside one filesystem timestamp tick leaves both values unchanged, so the change is invisible and the file's stale contribution is kept. Measured on this Windows machine: 163 of 200 back-to-back same-size rewrites produced a byte-identical mtimeMs, and gaps between consecutive distinct mtimes ran up to 10ms. ext4 records nanoseconds, so Linux never reaches the bound — which is why ubuntu CI has never surfaced it in either module.\n\nNOT KNOWN TO BE FAILING ANY TEST TODAY. It is filed because it is the same hazard in the module the fixed one was modelled on, not because something is red. Verify first whether any current test exercises a same-length rewrite; if none does, that absence is itself the gap to close.\n\nFIX: mirror what web now does — trust mtime only once it is older than a granularity bound, and inside that window compare a hash of the file's bytes, dropping the hash as soon as the mtime ages out so the steady state stays stat-only. See packages/web/src/server/task-usage/incremental-task-usage.ts for the shape, including two approaches that were tried and rejected (hashing unconditionally, and treating fresh files as outright modified — the latter resurrects pruned entries).\n\nWorth deciding while here whether the two implementations should share one helper rather than be parallel copies. They sit in different packages (hench is execution tier, web imports hench's domain siblings), so a shared home would have to be @n-dx/llm-client or a small utility both can import; if that is not worth it, say so and note the twin explicitly in both files."
---
