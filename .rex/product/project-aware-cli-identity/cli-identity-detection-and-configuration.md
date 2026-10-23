---
id: "a9fcab05-166f-43eb-81f7-05f8c3cef117"
type: "capability"
title: "CLI Identity Detection and Configuration"
slug: "cli-identity-detection-and-configuration"
statement: "n-dx detects the project's installed CLI command name from the bin field in package.json, stores it as cli.name in .n-dx.json, and uses that name wherever hench agent prompts and task briefs refer to CLI commands."
criteria: [{"id":"c1","text":"The CLI name resolver shall read the first binary name from the bin field of package.json at the project root."},{"id":"c2","text":"When ndx init runs, ndx init shall write the resolved CLI name as cli.name in .n-dx.json."},{"id":"c3","text":"ndx config shall read cli.name and shall write it, so a user can override the detected value by hand."},{"id":"c4","text":"If package.json has no bin field, the CLI name resolver shall default cli.name to 'ndx'."},{"id":"c5","text":"The hench brief builder shall read cli.name from the project config and inject it as a named template variable into system prompts and task briefs."},{"id":"c6","text":"Hench agent system prompt templates shall reference CLI invocations through the resolved cli.name variable rather than the literal 'ndx'."},{"id":"c7","text":"When cli.name is set to a custom name such as 'myapp', hench shall render that name in a run's prompt context in place of 'ndx'."}]
source: "smart-add"
---

n-dx is a toolkit that can be embedded in any project under any CLI binary name. Currently the dashboard, agent prompts, and help text hardcode 'ndx' as the command prefix. This feature detects the project's actual installed command name from package.json and stores it in .n-dx.json as cli.name, providing the resolution point for all surfaces that display or execute CLI commands.
