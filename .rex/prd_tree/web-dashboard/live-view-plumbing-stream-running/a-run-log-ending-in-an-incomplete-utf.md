---
id: "5fa5954d-cb5f-4c20-bb15-04aa969f7d03"
level: "task"
title: "A run log ending in an incomplete UTF-8 sequence makes the Log tab refetch the same cursor forever"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T16:17:11.420Z"
completedAt: "2026-10-01T16:27:11.705Z"
endedAt: "2026-10-01T16:27:11.705Z"
resolutionType: "code-change"
resolutionDetail: "readLogChunk takes { final }. For a run that is not running, it emits the trailing unfinished character at EOF as U+FFFD. utf8CompletePrefixLength no longer holds back 0xC0, 0xC1 or 0xF5 and above. The client stop on a non-advancing next was already shipped in f5d84515."
acceptanceCriteria:
  - "For a finished run whose log ends in an incomplete UTF-8 sequence, the log route returns the remaining bytes (decoded as U+FFFD) and `more: false` (unit test with bytes [0x41,0xE9])."
  - "The client stops reading when the server's `next` does not advance (unit test)."
  - "Existing run-tail tests for characters split across chunks still pass."
description: "Failure: `readLogChunk` in `packages/web/src/server/run-tail.ts:191-231` holds back trailing bytes that do not form a complete UTF-8 character, so `next` stays below the file size and the handler answers `more: true`. The client loop in `packages/web/src/viewer/views/live-log.ts:66-78` (`for(;;)`) re-fetches the same cursor with no delay. Trigger: the log's last byte is a lead byte that never gets its continuation bytes, for example a process killed mid-character or a tool that printed a Latin-1 0xE9 last. The reviewer reproduced it: bytes [0x41,0xE9] returned next=1,size=2 on every read. For a finished run this is a permanent busy loop between the user's browser and server; for a running run each poll tick starts another concurrent loop (see the overlapping-reads item).\n\nReachability: any killed or odd-output run viewed in the Log tab. No test covers it. Verdict: must-fix (reviewer graded should-fix; raised because the loop never ends and the fix is small and in the same code as the overlapping-reads fix).\n\nOptions:\n- (a) Server: when the read reached EOF and the run is not running, or the held bytes can never become valid (lead byte >= 0xF8, or a non-continuation after a lead), emit the remainder so it decodes to U+FFFD. About 10 lines.\n- (b) Client: stop the loop when `body.next` equals the cursor it sent. One line.\nRecommended: both, with a test."
lastModified: "2026-10-01T16:27:13.595Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
