---
id: "7106236d-a872-4d8e-951b-771aedb8076c"
type: "change"
title: "The pair reviewer CLI drops the user's own .n-dx.local.json guard.env.allow while the repository is untrusted"
slug: "the-pair-reviewer-cli-drops-the-user-s"
intent: "Scenario: untrusted checkout, user sets `hench.guard.env.allow: [\"MY_CRED\"]` in `.n-dx.local.json`. `loadProjectEnvPolicy` (packages/core/config.js:2769) reads the policy through `loadAllConfigs` → `loadEffectiveProjectConfig`, which deep-merges `.n-dx.local.json` into `.n-dx.json`, so the local entries are indistinguishable from repository ones. `applyRepoTrustToEnvPolicy` (config.js:2749) then drops the whole `allow` list while restricted, so the reviewer CLI (`ndx pair-programming`, hench pair review via loadVendorCliEnv) loses the user's own entry. hench's agent shell (`applyRepoTrust`, packages/hench/src/store/trust.ts) and repository commands (`repoCommandEnv`) keep `.n-dx.local.json` entries; this path is now the stricter odd one out. Over-restrictive, not a leak.\n\nReachable: `ndx pair-programming` / pair review in an untrusted checkout with a local allow entry. Pre-existing (added by the sibling #656 fix), surfaced reviewing task 942e0619.\n\nFix options: (1, recommended) in applyRepoTrustToEnvPolicy keep the allow entries from the local config file (read `hench.guard.env.allow` from `.n-dx.local.json`, as repo-command-env's localEnvPolicy does) and drop only the rest. Cheap, one branch + test. (2) Build the reviewer env policy via llm-client so all three paths share one rule; larger, touches the gateway surface."
acceptanceCriteria:
  - "In an untrusted checkout, a variable named in .n-dx.local.json hench.guard.env.allow reaches the reviewer CLI environment (test asserts presence only)"
  - "A repository-supplied guard.env.allow entry still does not reach it while untrusted"
  - "The once-per-dir warning names only the dropped repository entries"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"942e0619-903d-4343-b07f-91d95f337327","run":"7c30a468-59a1-4aa8-a815-49c036b8b367"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
