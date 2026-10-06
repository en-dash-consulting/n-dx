---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/llm-client": patch
---

`ndx work --task=<id> --resolve [flags] <dir>` (`hench run --resolve`) prints one JSON object describing the run those flags would start, without starting it: the task, the workspace, every setting (vendor, model, provider, permission mode, review and review model, test gate, budgets, fresh, allow-dirty, reset-deferred) with the config key that supplied it, the per-run options with their flags, types and allowed values, the equivalent `ndx work` command, and each reason the run would refuse — task-not-found, not-actionable, claimed-elsewhere, tree-not-conformant, vendor-unset, vendor-cli-missing, provider-unsupported, model-vendor-mismatch, dirty-tree. It exits 0 when it reports refusals, and takes no claim, writes no PRD or git state and starts no vendor CLI. Resolution uses the run's own flag parsing and model chain, so the reported model is the one the run uses. `resolveTaskModel` now also returns the `source` key that supplied its model.
