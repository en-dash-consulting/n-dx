---
"hench": patch
---

Agent prompts and task briefs now reference the project's resolved CLI command name (cli.name from .n-dx.json, default "ndx") instead of hardcoding it — system prompt Project Info names the CLI, the brief's Project section carries it, and task-selection error suggestions use it.
