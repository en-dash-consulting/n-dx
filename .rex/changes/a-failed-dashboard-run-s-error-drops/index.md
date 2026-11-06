---
id: "bbb81405-4ece-4ad9-8fb4-82d9ee867faf"
type: "change"
title: "A failed dashboard run's error drops hench's refusal header when the dirty-file list is long"
slug: "a-failed-dashboard-run-s-error-drops"
intent: "Found by adversarial review of 459057dc (run 9e670e38). packages/web/src/server/routes-hench.ts handleExecute: when stderr has text, entry.state.error = runEndOutput(stderr, stdout, EXEC_STATE_ERROR_STREAM_CHARS = 300). hench's dirty-tree refusal (packages/hench/src/agent/lifecycle/shared.ts ~3173) is a ~150-char header followed by up to 20 file lines (DIRTY_FILE_LIST_LIMIT) plus \"… and N more\". With more than about 4 dirty files with ordinary path lengths, the last 300 characters of stdout are only file paths. Live and the task card then show the stderr warning and a partial file list, with no \"Refusing to start\" reason.\n\nReachable: POST /api/hench/execute on a dirty tree (more than about 4 files) while hench also warns on stderr. Verdict: should-fix (medium). This is still better than before 459057dc, when only the warning showed, and the execution log keeps 1000 chars per stream.\n\nOptions:\n(a) Raise the per-stream cap to RUN_END_STREAM_MAX_CHARS (4000). One line. It covers 20 file lines of up to about 190 chars each. Risk: the task card renders \"Failed: <error>\" inline, so a multi-KB error may need clamping in the UI.\n(b) Keep the head of the last stdout paragraph instead of its tail: take stdout from the last line that is not indented. This needs no text matching, because the file lines are indented. Recommended. Moderate cost.\n(c) Have hench put the refusal reason on one line at the end of its output. Cross-package change."
acceptanceCriteria:
  - "When a dashboard run exits 1 with a stderr warning and a stdout dirty-tree refusal listing 20 files, the broadcast execution state's error contains \"Refusing to start\" (web test)"
  - "The stderr-only and short-refusal cases from routes-hench-execute-failure-detection.test.ts still pass"
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
priority: "medium"
discoveredFrom: {"item":"459057dc-b0be-4725-8d20-074b1f2b0fb8","run":"9e670e38-fe3c-4d50-a73c-a2a114bfb956"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
