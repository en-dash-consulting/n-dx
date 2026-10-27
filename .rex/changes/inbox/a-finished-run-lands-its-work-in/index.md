---
id: "6af0a1c8-3df5-4348-8ae3-1056b6a1e965"
type: "change"
title: "A finished run lands its work in consumer projects"
slug: "a-finished-run-lands-its-work-in"
intent: "Two defects seen in consumer project caos (runs e3fe956f and 2fb96507) that make a run whose work passed every check end failed, with its work uncommitted or its completion recorded outside hench's hold. First, the spawned Claude session cannot call the rex MCP write tools hench itself attaches. Second, the completion gate excludes review repairs even when nothing will commit them, so its refusal leaves out the agent's actual work."
plannedRelease: "0.7.2"
priority: "critical"
tags:
  - "0.7.2"
  - "hench"
  - "run-lifecycle"
source: "ndx-capture"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "Finalize gate must discount only what the commit prompt will actually commit: staged work only with a pending message, reviewer repairs on both paths" (9fe4e4e6-eb03-476f-9955-d0013a0c6c81).
