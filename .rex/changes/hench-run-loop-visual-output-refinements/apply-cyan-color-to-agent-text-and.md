---
id: "67886370-b75c-4e7a-ad8c-2a66b4f281a9"
type: "task"
title: "Apply cyan color to agent text and task separator line in hench run output"
slug: "apply-cyan-color-to-agent-text-and"
description: "Color the agent narrative text (lines emitted by the agent during a run) and the '_____ Task _____' separator line in cyan. No other existing color assignments should change — this is a targeted addition to the existing semantic color scheme established for hench run-loop output."
acceptanceCriteria:
  - "Agent text lines rendered during a hench run are colored cyan in TTY output"
  - "The '_____ Task _____' separator line is colored cyan in TTY output"
  - "All other existing color assignments (pink loop separator, yellow warnings, label prefixes, etc.) are unchanged"
  - "Cyan is suppressed when NO_COLOR is set or output is not a TTY, consistent with existing color suppression behavior"
  - "Existing color integration tests pass without modification"
priority: "low"
tags:
  - "hench"
  - "cli"
  - "color"
source: "smart-add"
---
