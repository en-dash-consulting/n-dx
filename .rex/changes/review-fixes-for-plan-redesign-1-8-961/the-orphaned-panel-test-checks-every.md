---
id: "1ab384f9-dad3-4e88-b1a8-11fd4b40deac"
type: "task"
title: "The orphaned-panel test checks every exported panel"
slug: "the-orphaned-panel-test-checks-every"
description: "Stack review finding on #961 at packages/web/tests/unit/viewer/diagnostic-panels-mounted.test.ts:16 (review comment 4488636475).\n\n**Should fix: this test can never fail**\n\n`PANELS` lists only `WsHealthPanel` and `ThrottleControlsPanel`, and this PR deletes both from `components/index.ts`. Each case starts with `if (!new RegExp(...).test(barrel)) return;`, so every case returns before its `expect` and vitest reports green without checking anything. Either drop the file or make it general: for every `*Panel` the barrel exports, assert that some view renders it. The general version would also catch the next orphaned panel, which is the bug this capture was about."
acceptanceCriteria:
  - "diagnostic-panels-mounted.test.ts asserts, for every *Panel the components barrel exports, that some view renders it"
  - "The test fails when an exported panel is rendered by no view (no case returns early without an expect)"
---
