---
id: "44762a96-1caa-4c16-92a3-cd356b5801d1"
type: "task"
title: "Describe's prior runs reads only the 200 newest run files, so an older task reads as never run"
slug: "describe-s-prior-runs-reads-only-the"
description: "Found by the adversarial review of the archived-run fix (task 9faecb67). Verdict: should-fix. Severity: low. It is not reachable today, because nothing calls createPacketSources yet; it becomes reachable once the M2/M3 lens route wires it.\n\nScenario: packages/web/src/server/sidecar/packet-sources.ts runs() parses at most MAX_RUN_FILES (200) records, taking the newest by mtime. Hench keeps runs for 180 days by default. If a project has more than 200 run files and none of this task's runs is among the 200 newest, runs() returns []. The Describe packet then prints \"No run of this task is recorded.\" That is the same silent wrong answer task 9faecb67 fixed for archived runs, now only bounded by the cap.\n\nOptions:\n(a) Have runs() report that it truncated, for example by returning { runs, truncatedAt } or adding a `scanned` count to RunStatusRead[]'s wrapper. The builder then says \"No run among the newest 200 records.\" This is cheap and honest. Recommended.\n(b) Read only taskId cheaply without parsing whole records. This is not possible for gzipped files.\n(c) Index runs by task. This would need hench cooperation and a gateway, so it is not worth it for M1."
acceptanceCriteria:
  - "With more than 200 run files and the task's only run older than all of them, the Describe packet says the scan was truncated instead of 'No run of this task is recorded.'"
  - "A unit test in packages/web/tests/unit/server/sidecar-packet-sources.test.ts seeds 201 run files with the task's run oldest by mtime and asserts that wording"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
