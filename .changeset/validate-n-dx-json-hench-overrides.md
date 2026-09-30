---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Validate `.n-dx.json`/`.n-dx.local.json` hench overrides (and workflow template
overlays) against `HenchConfigSchema` instead of merging them in unchecked.

`loadConfig` validated `.hench/config.json` but then deep-merged the project
overrides on top with no validation, so `hench.maxTurns: -5` produced a run
that "completed" having executed no turn, `promptCacheTtl: "1hour"` silently
degraded to a 5-minute cache marker, and an invalid `prune` group crashed the
pruner. Workflow templates hit the same gap through `applyTemplate`.

`loadConfig` now re-validates the merged result. An invalid top-level override
field reverts to its value in the already-validated base config (or the
schema default) with a warning naming the field and the file it came from
(`.n-dx.json` or `.n-dx.local.json`) — it never stops the run, matching how a
malformed `.hench/config.json` is already salvaged. `hench template apply`
gets the same treatment: an invalid template scalar now warns and falls back
instead of refusing the whole template.

`@n-dx/llm-client` gains `loadProjectOverrideSources`, exposing each
project-config file's section separately so a caller can attribute a bad
value to the file it came from.
