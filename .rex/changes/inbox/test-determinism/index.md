---
id: "836b82f1-5f29-4917-8ce0-0d720a059824"
type: "change"
title: "Test determinism"
slug: "test-determinism"
intent: "Four groups of tests still pass or fail on wall-clock time, so under load a suite marks an autonomous run failed after its work has already committed, which teaches people to disbelieve red. Replace them with counts of work done: the PRD atomic-write test compares two adjacent micro-spans and needs a work count; the run-loop test lower-bounds a real timer and the DOM performance monitor keeps an absolute count budget; the search-index and route budgets bypass the documented multiplier; real-timer ordering assertions carry no duration identifier, so the inventory scanner cannot see them and they must be registered by hand. The wall-clock inventory scan already exists (tests/e2e/wall-clock-inventory-policy.test.js) and fails a new clock-bounded assertion that is not registered, but it only detects assertions whose subject names a duration; extend it so clock-based ordering assertions without a duration identifier are caught too. Scaling the assertions was tried during the last batch and rejected on measurement. 0.7.1 fixed a separate set of load-sensitive tests (viewer hook tests now flush effects through act(), the cli-hints and file-watcher waits scale with the budget multiplier, and every hook budget is at least its test budget); those need no further work. Related rex tasks: 2098655c, 26ce64cf, 74d203ab, 518ece53.\n\nGoal: A red test gate means the code is wrong, not that the machine was busy."
acceptanceCriteria:
  - "The four listed tests no longer assert on elapsed time; each asserts on counted work (traversal steps, vnode diffs, DOM records)."
  - "The existing wall-clock inventory scan also flags clock-based ordering assertions that carry no duration identifier, and every remaining clock bound is registered."
  - "The full suite passes under concurrent build load three times in a row."
plannedRelease: "0.8.0"
priority: "high"
tags:
  - "0.8.0"
  - "test-determinism"
source: "caos work management: feature ndx 0.8.0 - Test determinism"
---
