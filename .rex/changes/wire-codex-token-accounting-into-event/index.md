---
id: "7feabb7f-376f-4087-8a7a-43bc0e50695b"
type: "change"
title: "Wire Codex token accounting into event-pipeline close path"
slug: "wire-codex-token-accounting-into-event"
intent: "When config.useEventPipeline is on, cli-loop.ts close handlers (~lines 631-633, 652-653) have empty catch blocks that never call parseCodexCliTokenUsage, unlike the legacy path (~714-717, 760-763). Since codex --json emits JSONL, JSON.parse(fullStdout) throws and the text-format token parser is the norm — so enabling the event pipeline silently zeroes Codex token/credit accounting. Wire parseCodexCliTokenUsage (already imported) into the event-pipeline non-JSON catch path and add a test covering useEventPipeline:true with non-JSON codex stdout."
touches:
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
priority: "high"
---
