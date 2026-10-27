---
id: "b86e2af1-19c7-43ee-90a1-c82ce7038fae"
type: "change"
title: "Implement rolling 10-line grey output window for rex run console"
slug: "implement-rolling-10-line-grey-output"
intent: "Replace unbounded stdout streaming during rex/hench runs with a rolling buffer that renders only the most recent 10 lines. Lines should be rendered in grey/dim using the ANSI color helpers already present in llm-client. The window should overwrite previous lines in-place via cursor control when stdout is a TTY, and fall back to plain streaming when it is not."
acceptanceCriteria:
  - "Console shows at most 10 lines of run output at any time during a rex run"
  - "Each displayed line is rendered in grey/dim via the existing colorDim ANSI helper"
  - "When a new line arrives, the oldest visible line is evicted from the window"
  - "Full output is not discarded — it is captured for log file persistence"
  - "Rolling overwrite is only applied when stdout is a TTY; non-TTY and NO_COLOR environments receive plain streaming output"
amends: [{"target":"8f175c2d-6868-4687-a7e5-355e78f785f1","delta":"modified","summary":"Implement rolling 10-line grey output window for rex run console","base":"b2425413bdd86f8fac86c2e8cff387944f3bdb0c8f4ecde4bf22836beb636c4c"}]
priority: "medium"
tags:
  - "hench"
  - "cli"
  - "output"
source: "smart-add"
---
