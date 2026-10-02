---
id: "b9fad242-b388-4995-8f18-1043ce097c16"
level: "task"
title: "Log tab tail reads overlap and append the same chunk twice when a read takes longer than the 500 ms poll"
status: "completed"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T16:01:03.579Z"
completedAt: "2026-10-01T16:09:17.590Z"
endedAt: "2026-10-01T16:09:17.590Z"
resolutionType: "code-change"
resolutionDetail: "live-log.ts useRunLog: inFlight/again guard so only one read runs at a time; paging loop ends when more:true but cursor did not move. Two new tests; viewer suite green; committed f5d84515."
acceptanceCriteria:
  - "Only one log read is in flight at a time for a run; a tick that fires during a read schedules one follow-up read instead of starting a second."
  - "A unit test with a deliberately slow fetch on a running run shows each line exactly once in the buffer and in the downloaded text."
  - "Existing live-log tests pass."
description: "Failure: `packages/web/src/viewer/views/live-log.ts:63-86` calls `read()` immediately and then every `LOG_POLL_MS` (500 ms) through `setInterval` while the run is running, with no in-flight guard. A read slower than 500 ms (a 2 MB first chunk from `MAX_LOG_CHUNK_BYTES`, a busy server, or several `more:true` pages) lets the next tick fetch the same `from=cursorRef.current`; both responses call `buffer.append(body.content)`, so lines appear twice. That corrupts line numbers, the turn count, search counts and the Download .log, which joins every chunk.\n\nReachability: any running run whose log is large or whose server is slow. Verified in code. The `cancelled` flag only covers unmount and run changes; the events tail in `hooks/use-live-task.ts:212` has an `inFlight`/`again` guard and this hook does not. The test's fetch mock resolves instantly on a completed run, so the interval never starts.\n\nVerdict: must-fix (severity high). Fix together with the incomplete-UTF-8 loop in the same function.\n\nOptions:\n- (a) Recommended: copy the `inFlight`/`again` pattern from use-live-task.ts. Small.\n- (b) Replace setInterval with a setTimeout chain that schedules the next read after the current one settles. Small."
lastModified: "2026-10-01T16:09:17.984Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
