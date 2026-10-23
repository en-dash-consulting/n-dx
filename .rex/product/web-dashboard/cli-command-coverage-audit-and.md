---
id: "749cecdc-4d4c-4468-ae08-5e28e117996c"
type: "capability"
title: "CLI Command Coverage Audit and Dashboard Trigger Controls"
slug: "cli-command-coverage-audit-and"
statement: "The web dashboard lets users trigger high-impact ndx CLI commands, including analyze, plan, sync, export and self-heal, and shows their progress, output and outcome without the terminal."
criteria: [{"id":"c1","text":"The web dashboard shall provide a trigger control for each of the ndx analyze, ndx plan, ndx sync, ndx export and ndx self-heal commands."},{"id":"c2","text":"When a user activates a dashboard trigger control, the web server shall invoke the equivalent CLI operation through its MCP or REST surface."},{"id":"c3","text":"While a triggered command is running, the web dashboard shall show real-time progress or log output for it."},{"id":"c4","text":"While a long-running command (analyze, plan or self-heal) is running, the web dashboard shall show a spinner or a log stream."},{"id":"c5","text":"When a long-running command (analyze, plan or self-heal) finishes, the web dashboard shall show a notification saying whether it completed or failed."},{"id":"c6","text":"If a triggered command fails, the web dashboard shall show the error clearly to the user."},{"id":"c7","text":"When a user triggers a destructive or irreversible operation (such as plan --accept or self-heal), the web dashboard shall ask the user to confirm before it runs the operation."}]
source: "smart-add"
---

The web dashboard currently focuses on status views and configuration panels, but provides no way to trigger most ndx CLI commands (analyze, plan, recommend, sync, export, self-heal, refresh, ci). Users must fall back to the terminal for core workflow operations. This feature closes that gap by auditing coverage then implementing trigger controls for high-impact commands.
