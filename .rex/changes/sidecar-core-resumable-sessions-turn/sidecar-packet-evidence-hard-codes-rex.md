---
id: "fc4ad798-1565-4492-98dc-0d9be53d57d5"
type: "task"
title: "Sidecar packet evidence hard-codes rex's cache dir as \".cache\" instead of rex's own constant"
slug: "sidecar-packet-evidence-hard-codes-rex"
description: "Found by the adversarial review of afc0a661. Verdict: should-fix (low). This is contract drift with no current failure.\n\npackages/web/src/server/sidecar/packet-sources.ts, evidence(): `const cacheDir = join(ctx.rexDir, \".cache\")`, passed to rex's loadTrailerCommits/loadCommitFiles, which write trailer-commits.json and commit-files.json there. rex-gateway.ts already re-exports PRD_CACHE_DIRNAME, and its comment records that a duplicated '.cache' literal in prd-io.ts once caused a real bug (a cache file nobody gitignored or discounted). If rex moves its cache dir, the packet would write a second, ungitignored cache.\n\nFix: use PRD_CACHE_DIRNAME from rex-gateway (one line). An alternative is to ask rex for its paths (RexPaths.cacheDir) if the gateway gains that."
acceptanceCriteria:
  - "packet-sources.ts builds the evidence cache dir from rex's exported constant, with no '.cache' string literal"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
