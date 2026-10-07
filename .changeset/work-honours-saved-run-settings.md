---
"@n-dx/hench": patch
---

`ndx work` now applies the run settings saved on a task.

**Behaviour change.** A task carrying a `run` block (written by the rex MCP tools, `rex update --run`, or the dashboard) now runs with those settings. Each setting follows CLI flag > task `run` > `hench.*` > `llm.*` > default, so a saved model, provider, permission mode, review pass, test gate, budget or context note takes effect unless a flag overrides it. A project whose tasks carry no `run` block runs exactly as before.

Settings are resolved **per task, after selection** rather than once per invocation, so inside `--loop`, `--iterations` and `--epic-by-epic` each task runs with its own — including a saved `provider`, which now chooses the CLI or API loop for that task alone. An explicit CLI flag still applies to every task in the loop. One resolver serves both the run path and `ndx work --resolve`, so the preview cannot report settings the run would not use.

A saved value that cannot be honoured never wedges a loop: a model the active vendor cannot run is skipped with a warning naming the task, and a block that fails validation is ignored whole with one warning.

Run records are honest about the model: `weight` is the tier of the model that actually ran rather than the tier `agent.execute` routes to — so a run an explicit `--model`, a `hench.models` pin or a saved block put on the heavy-tier model no longer records as `standard` — and the new `modelSource` field names the setting that chose it.
