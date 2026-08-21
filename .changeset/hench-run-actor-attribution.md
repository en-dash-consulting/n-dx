---
"hench": patch
---

Stamp `actor` (resolved from git `user.name`/`user.email`, falling back to the OS username, then `"unknown"`) and `host` (`os.hostname()`) on every `RunRecord` at run start — `ndx work`, the API loop, and `hench record` (assisted `/ndx-work` runs). Both fields are additive on the schema, so pre-existing run files without them still load normally. `hench show` and `hench run`'s completion summary now display the actor; `hench status` appends it to each run line. Resolution is a local copy of rex's `core/identity.ts` algorithm (`process/actor-identity.ts`) rather than a new `rex-gateway.ts` export, since `resolveActor` isn't part of rex's public API and this change is scoped to the hench package only.
