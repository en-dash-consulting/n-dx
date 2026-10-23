---
id: "f00023d2-c399-4bd2-beb8-481549a6ad37"
type: "change"
title: "Intercept SIGINT during hench run loop and transition to graceful cancellation state"
slug: "intercept-sigint-during-hench-run-loop"
intent: "Register a SIGINT handler at the start of a hench run that prevents abrupt process exit. When Ctrl+C is received, signal the agent loop to stop at the next safe checkpoint (end of the current tool call or LLM turn) rather than mid-operation. Restore the default SIGINT handler after the run completes normally so Ctrl+C during post-run prompts works as expected."
acceptanceCriteria:
  - "Pressing Ctrl+C during an active agent loop does not exit the process immediately — it sets a cancellation flag"
  - "The agent loop detects the cancellation flag at the next loop iteration boundary and exits cleanly"
  - "Any in-flight tool call or LLM request is allowed to complete before the loop exits (no torn state)"
  - "The default SIGINT handler is restored after the run concludes, whether cancelled or not"
  - "A cancellation message is printed to the terminal indicating the run was interrupted"
touches:
  - "626d40cf-4513-4cb1-a767-0aabd05a5f7c"
priority: "high"
tags:
  - "hench"
  - "signal-handling"
  - "ux"
source: "smart-add"
---
