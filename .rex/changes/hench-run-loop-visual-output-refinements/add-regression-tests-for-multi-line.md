---
id: "cd39ee5e-585e-49a2-85a1-3b2b77b8f87e"
type: "task"
title: "Add regression tests for multi-line scroll window behavior"
slug: "add-regression-tests-for-multi-line"
description: "No automated tests currently assert that the rolling window stays within its 10-line bound when multi-line content is injected. Add unit tests that feed synthetic multi-line messages into the window renderer and assert the rendered output line count, plus an integration smoke test that pipes a hench run with known multi-line tool output and counts the terminal rows emitted."
acceptanceCriteria:
  - "Unit test: feeding a 4-line message followed by 3 single-line messages produces exactly 7 rendered lines"
  - "Unit test: a single message with 15 newlines is capped/truncated to fit within the 10-line bound"
  - "Unit test: mixed single- and multi-line messages never produce a rendered frame exceeding 10 lines"
  - "Integration test: a hench dry-run that emits known multi-line output passes the 10-line cap assertion"
priority: "medium"
tags:
  - "hench"
  - "cli"
  - "testing"
  - "regression"
source: "smart-add"
---
