---
id: "dd5bcb32-e250-472a-ba3f-4033e46b7dc5"
level: "task"
title: "Run records carry the commits a run made, backfilled for the hench era"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "evidence"
  - "graview"
source: "ndx-capture"
acceptanceCriteria:
  - "RunCommitRecord has an optional attribution field (start-head | subject | trailer | window); collectRunCommits stamps start-head on the live path and the schema accepts records without it"
  - "`hench backfill-commits [dir]` fills commits on every run record that has none, preferring a subject naming the run id, then an N-DX-Item trailer naming the run's task, then the run's authored time window on the main branch; merge commits and chore(prd) commits are never attributed"
  - "A commit inside two runs' windows is attributed to neither and counted as ambiguous; a run whose record already has commits is left as it is"
  - "The command is idempotent, prints counts per attribution and ambiguity, and --dry-run writes nothing"
  - "Unit tests cover the three attribution paths, ambiguity, the skip rules and idempotence against a real temporary git repository"
description: "RunRecord.commits is the one channel that ties a run, and so its task, to the code it changed, and no record on this repository has it: collectRunCommits needs run.startHead, which arrived with the trailer work on 2026-10-08, and 649 of the 672 runs are from February and March 2026, before any commit carried an N-DX-Item trailer. The live path stays as it is (startHead now reaches the record). A one-shot `hench backfill-commits [dir]` fills commits on every run that has none, from the evidence git holds: a commit whose subject names the run id, a commit whose N-DX-Item trailer names the run's task, else the commits on the main branch authored inside the run's window (startedAt to finishedAt plus a short pad), skipping merges and PRD-only chore(prd) commits and refusing a commit two runs' windows both claim. Each RunCommitRecord gains an optional attribution (start-head | subject | trailer | window) so readers can weigh it; live records say start-head. The command is idempotent, reports counts per attribution, and `--dry-run` prints without writing. 621 of this repository's runs have one to three commits inside their window; 20 windows overlap."
lastModified: "2026-10-11T03:32:24.352Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
