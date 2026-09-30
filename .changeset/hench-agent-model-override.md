---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Add `hench.models.<vendor>`, a per-vendor agent-only model override that
`ndx work` actually honours, and deprecate the dead `hench.model` scalar.

`hench.model` has never been read. `ndx work` resolved its model from
`--model`, then llm-client's task-model resolution for `agent.execute`
(`llm.routes`, `llm.tiers.<vendor>.<tier>`, `llm.model` / `llm.<vendor>.model`,
then the vendor default) — the config field's `"sonnet"` default never reached
the agent loop, and on a non-Codex vendor it was meaningless anyway.

`hench.models` is an optional map keyed by vendor (`claude`, `codex`,
`google`, `local`) of non-empty model strings. Only the entry for the *active*
vendor is consulted, so a config can carry a pinned model for every vendor it
switches between. It sits between `--model` and all `llm.*` model
configuration, which is what makes it agent-only: `analyze`, `plan` and the
dashboard's Ask panel keep resolving from `llm.*` alone, so pinning
`hench.models.claude` changes the executor without changing what anything else
runs. `--model` still wins, and an override incompatible with the active
vendor fails with the same actionable error a bad `llm.model` gets.

The vendor/model header reports it as `hench-override`. Resolution moved out
of `cmdRun` into `cli/commands/agent-model.ts` so the chain is testable on its
own.

Existing `hench.model` values stay ignored, so no project changes behaviour on
upgrade. The new key goes through the same post-merge override validation as
every other field: an invalid `hench.models` in `.n-dx.json` warns, falls back,
and does not stop the run.
