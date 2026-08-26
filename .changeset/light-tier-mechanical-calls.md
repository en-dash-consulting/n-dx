---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

Route mechanical single-shot LLM calls to the light model tier. In rex, `spawnClaude()` gains an optional task-weight parameter (default `"standard"`), and sibling renames, group renames, body merges, the consolidation guard, the granularity assessment pass, guided clarify rounds, and the post-prune consolidation pass now resolve the vendor's light-tier model (e.g. haiku) when no explicit model is given. In hench, pre-run commit-message generation resolves the light tier instead of the run's standard model. An explicit `--model` flag (or a per-vendor `lightModel` config for the light tier) still overrides tier resolution, and the active tier is surfaced in vendor-header/spinner output ("light tier").
