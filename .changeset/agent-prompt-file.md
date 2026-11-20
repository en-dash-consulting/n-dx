---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

A project prompt file, `.ndx/agent-prompt.md`, adds your own instructions to the system prompt of every `ndx work` run, its reviewer and the dashboard Sidecar.

Edit it in Settings › Workflow or Work › Tune, or point `agent.promptFile` in `.n-dx.json` at another file inside the project; `.n-dx.local.json` wins. The legacy layout reads `.n-dx-agent-prompt.md`, and `ndx migrate-layout` moves it. A missing or empty file changes nothing. A path that leaves the project is ignored with a warning, and text past 32 KB is cut with a warning. A Sidecar session reads the file when it opens. The dashboard reads and writes it through `GET` and `PUT /api/agent-prompt`.

API-provider runs now also apply `cli.name` and `hench.projectSkills`, which they used to skip.
