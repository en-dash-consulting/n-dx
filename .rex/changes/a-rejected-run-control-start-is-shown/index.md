---
id: "6908b250-7dca-4a70-bf51-045653ae2f71"
type: "change"
title: "A rejected run-control start is shown only inside the dropdown it closes"
slug: "a-rejected-run-control-start-is-shown"
intent: "Out-of-scope (pre-existing) finding from the adversarial review of task 28ab2232 (run 7d676695).\n\nScenario: in the top-nav run control, press Run when the server refuses the start (e.g. POST /api/run-commands/start answers 4xx: a job already running in another tab, or an unknown id). useRunCommands.start catches the rejection into its `error` state and returns normally, so RunCommandControl.handleStart (packages/web/src/viewer/components/run-command-control.ts) goes on to setOpen(false). The rejection text renders only as `.runcmd-error` inside the menu, which is now closed. The button keeps its idle look and title, so the user sees nothing happen. This happens at every width, and below 1440 px the label is hidden too.\n\nReachable: the dashboard top nav, any refused start or stop.\n\nOptions:\n1. Keep the menu open when `error` is set after start (start resolves a boolean, or handleStart checks the error). Cheap. Recommended.\n2. Fold the hook's `error` into the button's failed state (runcmd-btn--error and the title). This also covers a stop that fails.\n\nVerdict: out-of-scope (pre-existing, low)."
acceptanceCriteria:
  - "When POST /api/run-commands/start answers non-2xx, the rejection text is visible without reopening the menu (menu stays open, or the button shows the error state and title)"
  - "A unit test in packages/web/tests/unit/viewer/shell.test.ts stubs a 409 start and asserts the error is visible after the click"
touches:
  - "1a326041-9ce2-490e-80ae-55fbdaf81543"
priority: "low"
discoveredFrom: {"item":"28ab2232-830a-42b8-a80e-f2f4cf3902e7","run":"7d676695-7097-471c-9f9c-747cbc128fdc"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
