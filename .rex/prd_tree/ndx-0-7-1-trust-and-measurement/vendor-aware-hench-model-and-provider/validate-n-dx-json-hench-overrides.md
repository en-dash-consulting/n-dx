---
id: "b767dbff-ff4d-4bb5-b75f-fda8655a4fc8"
level: "task"
title: "Validate .n-dx.json hench overrides after the merge, falling back per field with a warning"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "pr-n"
  - "hench"
  - "config"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review of PR M tasks a0eaf286 (run 01d15d75, F2) and c4166591 (run 8dc53406, F2)"
acceptanceCriteria:
  - "`.n-dx.json` `{\"hench\":{\"maxTurns\":-5}}` produces a warning naming `hench.maxTurns` and `.n-dx.json`, and the run uses the validated base value."
  - "An invalid `promptCacheTtl` override warns and falls back to the base value, rather than silently sending a 5m marker."
  - "Valid overrides still win over `.hench/config.json`, unchanged."
  - "A user-template scalar that fails the schema is handled the same way."
  - "No run is stopped by an invalid override."
description: "`loadConfig` (`packages/hench/src/store/config.ts:62-83`) validates `.hench/config.json` against `HenchConfigSchema`, then deep-merges `.n-dx.json`'s `hench` section on top with no validation. User templates are copied in the same way (`store/templates.ts:132-135`). Every override therefore skips the schema. Verified against the built dist: `hench.maxTurns: -5` yields a run that \"completes\" having executed no turn; `maxTokens: 0` and `provider: \"nonsense\"` are accepted; `promptCacheTtl: \"1hour\"` silently degrades to a 5m marker; `prune: null` or `retainPairs >= triggerPairs` crashed the pruner (PR M hardened the pruner itself, but no other key).\n\nDecision 2026-09-24: fall back and warn. Re-validate the merged result. An invalid field reverts to its value from the validated base (or the default) with a warning naming the key and the file, matching how `salvageConfig` already treats `.hench/config.json`. It does not stop the run.\n\nCarried in N because N already owns the config section of `schema/v1.ts`; `store/config.ts` has no other owner in 0.7.1."
lastModified: "2026-09-24T20:30:45.956Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
