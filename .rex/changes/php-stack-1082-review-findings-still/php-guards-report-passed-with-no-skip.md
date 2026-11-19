---
id: "009f879d-64a5-4bbc-8c67-dd2f8dafa7da"
type: "task"
title: "PHP guards report \"passed\" with no skip reasons when one check ran and another was skipped"
slug: "php-guards-report-passed-with-no-skip"
summary: "When part of the PHP checks could not run, the run still reads as fully passed on the dashboard. The summary should say what was skipped, as it now does when everything was skipped."
description: "Verdict: should-fix, severity low. Found by the adversarial review of H8 (f32656011), which made the all-skipped case read \"PHP guards skipped\".\n\nScenario: a PHP project, `php` on PATH, `composer` not. The agent changes `index.php` and `composer.json`. `php -l ./index.php` passes; `composer validate` is skipped. `runPhpGuardsIfNeeded` (packages/hench/src/agent/lifecycle/shared.ts:1251-1260) emits the gate event \"PHP guards passed\" with `detail` undefined: `allSkipped` is false because one check ran. The only trace of the skip is `counts.skipped: 1`. The dashboard's after-run item shows the event's summary (packages/web/src/viewer/views/live-task-model.ts:216), so the user reads a full pass while composer.json went unvalidated.\n\nReachable: any `ndx work` run in a PHP project where exactly one of the two tools is missing and the change touches both kinds of file. The terminal log does print the `Skipped …` line; only the event is silent.\n\nOptions: (1) recommended: when `result.skipped` is non-empty and the guard passed, use the summary \"PHP guards passed — N check(s) skipped\" and put the skip reasons in `detail`; `ok` stays true. Cheap, one branch and a test. (2) leave the summary and only fill `detail` with the reasons; smaller, but the dashboard line still reads as a plain pass."
acceptanceCriteria:
  - "With one PHP check run and passed and another skipped, the gate event's summary says a check was skipped and its detail carries the skip reason, with ok true"
  - "A php-guards-finalize unit test covers php on PATH and composer missing with both a PHP file and composer.json changed, and fails against the current summary \"PHP guards passed\""
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "php"
source: "ndx-adversarial-review"
---
