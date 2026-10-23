---
id: "cb54ce3f-e213-4020-bfc5-1ed517a29060"
type: "capability"
title: "Transparent task selection and completion reasoning"
slug: "transparent-task-selection-and"
statement: "When ndx work selects and completes a task automatically, it shows why the task was chosen, the task's prior attempts and what kind of change the run made."
criteria: [{"id":"c1","text":"When ndx work --auto selects a task, the run header shall show why that task was chosen."},{"id":"c2","text":"When ndx work --auto selects a task, the run header shall show how many items were skipped."},{"id":"c3","text":"When ndx work --auto selects a task, the run header shall show how many items completing the task would unblock."},{"id":"c4","text":"When the selected task has prior attempts, the task card shall show the number of prior attempts and the status of the last one."},{"id":"c5","text":"If the selected task has no prior attempts, the task card shall show no attempt history."},{"id":"c6","text":"The run summary shall list each changed file with its classification as code, docs, config or metadata."},{"id":"c7","text":"When a run completes a task by changing only metadata, the run summary shall say that the completion is metadata-only."}]
priority: "medium"
---

ndx work --auto should make reasoning transparent at both ends of the run.
