---
id: "69eb6b07-7b69-49cb-8fd9-f1a67a4460ee"
type: "capability"
title: "ndx as the single CLI interface"
slug: "ndx-as-the-single-cli-interface"
statement: "Every user-facing command accessible through ndx."
criteria: [{"id":"c1","text":"The ndx CLI shall provide an equivalent command for every rex, sourcevision and hench command."},{"id":"c2","text":"When a user runs ndx --help, the ndx CLI shall list all commands without naming the package that owns each one."},{"id":"c3","text":"When a user runs an orchestrator-only command through the rex, sv or hench CLI, that CLI shall suggest the equivalent ndx command."},{"id":"c4","text":"When a user mistypes a command name, the rex, sv and hench CLIs shall still suggest the closest matching command."},{"id":"c5","text":"When a user runs ndx --help, the ndx CLI shall group commands by workflow stage."},{"id":"c6","text":"The ndx CLI shall leave package names out of its primary help output."}]
priority: "high"
---

Every user-facing command accessible through ndx. Users never need to know which package owns what.
