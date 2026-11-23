---
id: "2bb56c7f-cdf5-48d8-96b6-4d249208b551"
type: "task"
title: "Fix deep-run telemetry: primer message, classify token counts, and the --wait hint"
slug: "fix-deep-run-telemetry-primer-message"
summary: "Make a deep analysis report its model use correctly, so the cost of a run can be estimated, and warn batch scripts when model work continues after the command exits."
description: "From the real deep run (`analyze --deep --full`, TypeSafe judging with Claude escalation):\n1. **The log said \"[primer] skipped — no LLM calls in this analysis\" after about 250 model calls.** Fix the primer's condition in cascade mode, so it counts judgment-cascade and escalation calls.\n2. **`code.classify` on the claude vendor recorded 95 calls with 0 tokens.** Record the token usage the Claude CLI reports for escalation calls, so per-run cost can be estimated, as other phases do.\n3. **Zone naming can outlive the command.** Without `--wait`, it continues in a background child after analyze exits, and its errors go to `narration.log`. When stdout isn't a TTY, and background narration was started, print one line naming `--wait` and the log path.\n\nEach fix gets a targeted test. Item 2 needs a stubbed CLI reply with usage fields."
acceptanceCriteria:
  - "The primer message reflects the model calls the cascade and escalation made"
  - "Classify escalation calls record their token usage"
  - "Non-TTY runs that start background narration print a one-line hint naming --wait and the narration log"
priority: "low"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "sourcevision"
  - "telemetry"
blockedBy:
  - "d38080d7-5ed8-49e0-a77e-11ffe05c92ba"
---
