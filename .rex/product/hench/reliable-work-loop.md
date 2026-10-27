---
id: "6b0c3873-5607-4adc-9027-abd8d70ab0e3"
type: "capability"
title: "Reliable work loop"
slug: "reliable-work-loop"
statement: "The work loop runs autonomous tasks continuously, picks tasks in order, moves each task through its states atomically, checks the quality of its own work, and applies guardrails while it runs."
criteria: [{"id":"c1","text":"When an error occurs during a run, the work loop shall handle the error and continue autonomous execution."},{"id":"c2","text":"The work loop shall validate the quality of the work an autonomous run produces."},{"id":"c3","text":"While a run executes autonomously, the work loop shall apply safety guardrails to it."},{"id":"c4","text":"The work loop shall select tasks in their defined order."},{"id":"c5","text":"When a task changes state during execution, the work loop shall apply the transition atomically."}]
source: "llm"
---

Ensure robust and reliable autonomous execution with proper task state management, error handling, quality validation, and continuous operation capabilities
