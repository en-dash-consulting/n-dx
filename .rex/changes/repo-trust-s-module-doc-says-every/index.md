---
id: "dfa630df-b202-408d-b4a5-0017fcbcdecf"
type: "change"
title: "repo-trust's module doc says every local-config reader asks userLocalConfigApplies, but no production code calls it"
slug: "repo-trust-s-module-doc-says-every"
intent: "**Severity:** low · **Verdict:** should-fix (found by the adversarial review of 0681b775, run 2fe1f329).\n\n**Defect.** packages/llm-client/src/repo-trust.ts exports `userLocalConfigApplies` and re-exports it from public.ts. Its module doc says \"every reader that applies the local file regardless of trust asks it first (see userLocalConfigApplies)\". No production code calls it. The real gates read `RepoExecutionConfig.localConfigTracked` from an evaluation they already hold: hench applyRepoTrust, repoCommandEnv, core applyRepoTrustToEnvPolicy. trustedLocalConfig calls isLocalConfigTracked directly. Only local-config-tracked.test.ts calls the export.\n\n**Failure scenario.** The next contributor adding a local-config reader follows the doc, takes `userLocalConfigApplies` as the established gate, and doesn't check how the others actually decide. Or they treat the unused public export as removable, or as a contract. Nothing fails today.\n\n**Options.**\n1. (Recommended) Remove the export and its test assertions. Point the doc at `localConfigTracked` and `trustedLocalConfig`, which are the two mechanisms actually in use.\n2. Route the gates through `userLocalConfigApplies`. This costs an extra git spawn and evaluation where callers already hold one."
acceptanceCriteria:
  - "The repo-trust module doc names the mechanisms local-config readers actually use (localConfigTracked on the evaluation, trustedLocalConfig), with no claim about a helper they do not call"
  - "@n-dx/llm-client exports no local-config trust helper that production code does not call"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"0681b775-d1e2-4c19-9d82-c5e55cb1f09f","run":"2fe1f329-b2b8-49d6-abab-f3cb8206d289"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
