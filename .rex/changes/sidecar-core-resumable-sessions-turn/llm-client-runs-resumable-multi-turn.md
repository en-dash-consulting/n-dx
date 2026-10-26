---
id: "425819f5-821e-41ce-aaca-56fb84c3427e"
type: "task"
title: "llm-client runs resumable multi-turn vendor sessions with normalized events"
slug: "llm-client-runs-resumable-multi-turn"
description: "Lift hench's Claude/Codex resume adapters into an llm-client session API that hench and the Sidecar share. Cross-package (llm-client + hench); run attended with review. CAOS story: https://www.notion.so/3f7a80b71924810fb66ac7fbdc9bc4db."
acceptanceCriteria:
  - "start, sendTurn, interrupt, end and resume work on Claude CLI and Codex CLI"
  - "turns emit RuntimeEvents with token usage"
  - "hench's batch and fork strategies call the session API, and the existing hench adapter tests pass unchanged"
  - "one-shot createLLMClient unchanged"
priority: "high"
source: "caos"
---
