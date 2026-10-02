---
id: "dd953d6b-5fbf-4d27-91d3-c11049a9447c"
level: "task"
title: "The Log tab's started line hardcodes \"n-dx work --task=… --auto\" instead of the project's CLI name and real command"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T20:09:58.357Z"
completedAt: "2026-10-01T20:18:24.509Z"
endedAt: "2026-10-01T20:18:24.509Z"
acceptanceCriteria:
  - "The started line uses the project's CLI name (unit test with a non-default name)."
  - "For a deferred task the started line includes --reset-deferred."
description: "Failure: `startedLine` in `packages/web/src/viewer/views/live-log-model.ts:239` builds `n-dx work --task=… --auto` as a literal instead of using `useCliName()` (`hooks/use-project-metadata.ts:100`), so a project with a different CLI name sees the wrong command, and it omits `--reset-deferred`, which the server passes for deferred tasks (`routes-hench.ts:1810`). The tests at `tests/unit/viewer/live-log.test.ts:141,198` lock in the literal. The cli-name-labels policy test does not catch it because the string has no bare `ndx ` prefix.\n\nVerdict: should-fix (severity low).\n\nOptions:\n- Recommended: pass the CLI name into `startedLine` and build the flags from what the server actually ran. Small."
lastModified: "2026-10-01T20:18:24.896Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
