---
id: "d40d8d94-acc1-45b4-b247-fb1dded8b232"
type: "change"
title: "The Log tab never shows a log's last line when it has no trailing newline"
slug: "the-log-tab-never-shows-a-log-s-last"
intent: "Failure: `packages/web/src/viewer/views/live-log-model.ts:97-104,124` keeps an unterminated final line in `buffer.unfinished`, and `views/live-log.ts` never reads it. A run that crashed mid-line, or a progress line still being written, is missing from the Log tab, its line count and search, but appears in the Download file.\n\nVerdict: should-fix (severity low).\n\nOptions:\n- Recommended: render `unfinished` as a provisional last row (excluded from the committed line list), at least once the run has finished. Small."
acceptanceCriteria:
  - "A finished run whose log ends without a newline shows that last line in the Log tab and in search (unit test)."
touches:
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
---
