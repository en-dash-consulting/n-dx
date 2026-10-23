---
id: "be267023-2d02-452c-8248-b8eef65a2f2c"
type: "capability"
title: "Sequential Epic Execution"
slug: "sequential-epic-execution"
statement: "The product runs tasks one epic at a time, with automatic progression and completion detection, from the CLI or the web dashboard, and can restrict the work loop to a single epic or start a run from an individual task."
criteria: [{"id":"c1","text":"When the user specifies an epic, the hench work loop shall execute only tasks within that epic."},{"id":"c2","text":"When the user triggers execution from an individual task in the Rex task UI view, the system shall start a Hench run for that task."},{"id":"c3","text":"When epic-by-epic mode is started from the CLI, the work command shall process epics sequentially."},{"id":"c4","text":"When an epic is complete, the work command shall detect the completion and move on to the next epic automatically."},{"id":"c5","text":"The web dashboard shall let the user start epic-by-epic execution."},{"id":"c6","text":"While epic-by-epic execution is running, the web dashboard shall show its progress visually."},{"id":"c7","text":"While epic-by-epic execution is running, the web dashboard shall provide controls for the run."}]
source: "smart-add"
---
