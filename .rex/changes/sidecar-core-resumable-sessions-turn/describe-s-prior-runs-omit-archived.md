---
id: "9faecb67-51f5-4a01-b68f-4088716bd0f0"
type: "task"
title: "Describe's prior runs omit archived .json.gz run records, so a task with only archived runs reads as never run"
slug: "describe-s-prior-runs-omit-archived"
description: "Found by the adversarial review of afc0a661 (Sidecar lens packets). Verdict: should-fix. It is not reachable today because nothing calls createPacketSources yet, but it is reached as soon as the M2/M3 lens route wires it.\n\nScenario: hench run retention (packages/hench/src/store/run-retention.ts) gzips older run records to `<id>.json.gz`. createPacketSources().runs (packages/web/src/server/sidecar/packet-sources.ts, runs()) reads only `*.json`. For a task whose runs were all archived, the Describe packet prints \"No run of this task is recorded.\" That is a silent wrong answer the model will act on (for example, \"this has never been attempted\"). The read is also synchronous and parses every run file on each packet build.\n\nOptions:\n(a) Read `.json.gz` with gunzipSync too, filtering on taskId. This is cheap and matches hench's listRunFiles.\n(b) Reuse hench's run listing through a gateway. It is more correct long term but widens the web→hench surface.\nRecommend (a), and also cap how many files are parsed (newest first by mtime)."
acceptanceCriteria:
  - "createPacketSources(ctx).runs(taskId) returns runs recorded as `<id>.json.gz` as well as `<id>.json`"
  - "a unit test with a gzipped run record for the task makes the Describe packet list that run instead of 'No run of this task is recorded.'"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
