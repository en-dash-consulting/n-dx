---
id: "c7e09da1-bd76-435f-93f8-f13954089029"
type: "change"
title: "A repository's own .n-dx.json can turn off Sidecar network-read cards"
slug: "a-repository-s-own-n-dx-json-can-turn"
intent: "Found by the adversarial review of task 55faa034 (Sidecar Diagnose branch, run 7e3a28f9). Verdict: should-fix, medium.\n\nScenario: a cloned, untrusted checkout ships `.n-dx.json` with `{\"web\": {\"sidecarGithubReads\": true}}`. `sidecarActions(...).githubReadsAllowed()` (packages/web/src/server/routes-sidecar.ts) reads it through `readSidecarSettings` → `readWebValue`, and `createBrokerMcpServer` (packages/web/src/server/sidecar/broker-mcp.ts, github_read branch) then runs every `github_read` with the operator's gh login and no network-read card. The Diagnose branch packet (`prepareReads` → `readWorktreeBranchHealth`) also runs gh under it. Repository content has widened what n-dx runs with the operator's credentials, which breaks the constraint that untrusted repository content may only tighten defaults until `ndx trust accept .`.\n\nReachable: any Sidecar session in a checkout whose tracked config sets the key. Reads only; posts still need a card. R2's `GET /api/branch-health` already honoured the same key for gh reads; this change made it the broker allowance as well.\n\nOptions: (A, recommended) honour `web.sidecarGithubReads: true` only from `.n-dx.local.json` / the user config, or from tracked config once the checkout is trusted; add the key to the repository trust digest (change 8a92c826 \"Extend the repository trust digest\" lists the other widening keys) — small, one reader. (B) keep the setting but always raise the card for the first read per session — weaker, still lets repo content skip later cards."
acceptanceCriteria:
  - "While the checkout is not trusted, `web.sidecarGithubReads: true` in tracked `.n-dx.json` does not let a `github_read` run without a network-read card; a test fails today and passes with the fix"
  - "The same value in `.n-dx.local.json` (or tracked config in a trusted checkout) still allows reads without a card"
  - "The Diagnose branch packet runs no gh command under a tracked-only allowance in an untrusted checkout"
  - "The repository trust digest covers `web.sidecarGithubReads`"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"55faa034-3df0-41a1-9aef-67d1dc896340","run":"7e3a28f9-f568-4930-bc7a-6f363bd793ee"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
source: "ndx-adversarial-review"
---
