---
id: "55b88bcd-8e8a-474a-9053-7e0ceba66ebe"
level: "task"
title: "Inject ndx project context into pair-programming primary and reviewer executions"
status: "completed"
priority: "high"
tags:
  - "pair-programming"
  - "context"
  - "cli"
source: "smart-add"
startedAt: "2026-04-16T16:56:03.913Z"
completedAt: "2026-04-16T22:07:19.810Z"
resolutionType: "code-change"
resolutionDetail: "Added context assembly pipeline in pair-programming.js and threaded extraContext through hench's run/loop stack into buildPromptEnvelope."
acceptanceCriteria:
  - "CONTEXT.md is read from .sourcevision/ and passed to the primary hench run when the file exists"
  - "A compact PRD status excerpt (epic/feature/task titles only) is included in the context payload"
  - "The reviewer vendor CLI invocation receives the same context files"
  - "When any context file is missing the command proceeds without it, logging a warning but not failing"
  - "A --no-context flag suppresses context injection for debugging or CI use"
description: "The pair-programming command currently passes the user's description to hench as a bare --freeform string with no project context. The primary and reviewer models should receive ndx's accumulated knowledge — CONTEXT.md, a PRD status excerpt, and recent hench run summaries — so both models understand the codebase before acting. This context should be assembled from the local ndx data files and passed as a system-level or file-context argument to each vendor CLI invocation."
---
