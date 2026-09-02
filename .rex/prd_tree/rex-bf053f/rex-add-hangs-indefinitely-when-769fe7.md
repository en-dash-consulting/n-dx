---
id: "769fe73d-705f-431d-a342-a745425f06eb"
level: "task"
title: "rex add hangs indefinitely when stdin is an open pipe"
status: "completed"
priority: "medium"
source: "ndx-capture"
startedAt: "2026-09-01T15:09:26.925Z"
completedAt: "2026-09-01T15:23:08.468Z"
endedAt: "2026-09-01T15:23:08.468Z"
acceptanceCriteria:
  - "`rex add <level> --title=...` completes without reading stdin when a level and title are supplied"
  - "The piped-description smart-add form (`echo \"desc\" | rex add`) still works"
  - "A regression test runs rex add in manual mode with an open, never-closed stdin pipe and asserts it exits"
  - "Any remaining stdin read is bounded so a caller cannot hang forever with no output"
description: "`rex add task --title=... --parent=... --description=...` never returns when stdin is an open pipe rather than a TTY or /dev/null. Manual mode still consults stdin for the `echo \"desc\" | rex add` form, so it blocks on a read that never gets EOF. Observed: the command ran past a 120s timeout and had to be killed; re-running the identical command with `< /dev/null` completed immediately. This bites any non-interactive caller — CI, a spawned agent, a skill driving the CLI — and presents as a hang with no output rather than an error. Manual mode (an explicit level plus --title) should not read stdin at all; the piped form is only meaningful for smart mode."
lastModified: "2026-09-01T15:23:08.474Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
