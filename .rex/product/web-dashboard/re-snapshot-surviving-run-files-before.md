---
id: "377aa1d0-06cb-4fa1-82e9-86dccfeca2a4"
type: "capability"
title: "Re-snapshot surviving run files before the no-change short-circuit"
slug: "re-snapshot-surviving-run-files-before"
statement: "The incremental task-usage scanner re-evaluates the freshness of every surviving run file on each scan, so a file whose mtime has aged past the granularity window returns to the cheap stat-only comparison."
criteria: [{"id":"c1","text":"When the incremental task-usage scanner runs a scan, it shall re-snapshot every surviving run file, including on scans where no file was added, modified or deleted."},{"id":"c2","text":"When a run file first observed inside the mtime-granularity window has an mtime that has aged past that window, the incremental task-usage scanner shall drop the file's contentHash and compare it by stat only."},{"id":"c3","text":"If a scan finds no added, modified or deleted run files, the incremental task-usage scanner shall skip subtracting and re-reading per-file contributions."}]
tags:
  - "pr-329-followup"
  - "web"
  - "task-usage"
  - "performance"
source: "PR #329 review comment 3816985312 (ryrykeith)"
priority: "medium"
---

PR #329 review follow-up (unresolved comment on packages/web/src/server/task-usage/incremental-task-usage.ts:296).

The comment at lines 296-300 states the intent precisely: re-snapshot EVERY surviving file, because an unchanged file still needs its freshness re-evaluated — once its mtime ages past the granularity window the hash is dropped and it returns to the stat-only path, and keeping the old snapshot would pin it as forever-fresh and hash it on every scan.

That loop (line 301) sits *after* the no-change short-circuit at line 269, which returns early on any poll where nothing was added, modified, or deleted — the common case. So the re-evaluation never happens on quiet polls, and the pinning the comment warns about is exactly what occurs: a file first observed inside the mtime-granularity window keeps `mtimeMayBeShared` set and gets re-hashed on every poll indefinitely, instead of aging out to the cheap stat-only comparison.

Moving the re-snapshot loop above the short-circuit fixes it.
