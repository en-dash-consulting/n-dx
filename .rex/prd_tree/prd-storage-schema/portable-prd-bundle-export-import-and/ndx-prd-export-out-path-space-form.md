---
id: "7445cf68-d6eb-42d5-a98a-fe7fd76e990a"
level: "task"
title: "`ndx prd export --out <path>` (space form) drops the value and misroutes the export"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-09-10T17:19:18.199Z"
completedAt: "2026-09-10T17:19:34.609Z"
endedAt: "2026-09-10T17:19:34.609Z"
resolutionType: "code-change"
resolutionDetail: "ndx prd now rejects space-separated --out/--in/--item/--format with an actionable message before anything runs. Pinned by tests/e2e/cli-prd-args.test.js."
acceptanceCriteria:
  - "`ndx prd export --out bundle.json .` exits non-zero with a message telling the operator to write --out=<path>, and writes nothing"
  - "`ndx prd import --in bundle.json .` fails the same way"
  - "No temp file is left behind next to the project after the rejected invocation"
  - "An e2e test covers the space-separated forms for both subcommands"
description: "Verdict: should-fix (severity low). Found by adversarial review of the portable-prd-bundle branch diff.\n\nFailure scenario: the orchestrator's `extractFlags` (packages/core/cli.js:503) keeps only `-`-prefixed tokens and `resolveDir` takes the last bare token, so `ndx prd export --out bundle.json .` spawns `rex export --out .` — rex (whose own parser DOES accept the space form; `out`/`in` are in its VALUE_KEYS) resolves `--out` to the project directory itself, and the atomic write's `rename(tmp → cwd)` fails with a raw error, leaving a stray `<dir>.<pid>.<uuid>.tmp` file beside the project. `ndx prd export --out bundle.json` (no trailing dir) instead errors with \"Missing .rex in bundle.json\". No corruption, but garbled failures for a form the underlying CLI accepts — the garbling is purely the ndx tier. Same applies to `--in` on import.\n\nReachability: any operator typing the space-separated form the shell muscle-memory suggests. This is the orchestrator's long-standing arg model; the new path-valued flags made it sharper, which is why it is scoped to the bundle feature rather than a global parser change.\n\nSolution options:\n(a) RECOMMENDED — in `handlePrd`, reject a bare `--out`/`--in`/`--item` (token without `=`) before spawning, with the same \"space-separated form is not supported; write it as --out=<path>\" message rex's readScope uses for `--item`. Localized, no parser changes.\n(b) Make the ndx tier value-aware for these flags — more invasive, touches the shared extractFlags/resolveDir model used by every command."
lastModified: "2026-09-10T17:19:34.634Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
