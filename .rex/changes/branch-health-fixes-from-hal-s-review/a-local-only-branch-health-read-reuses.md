---
id: "09c386ce-7fe6-468e-9a85-2fe0daf1e15c"
type: "task"
title: "A local-only branch-health read reuses a PR base gh has since said no longer exists"
slug: "a-local-only-branch-health-read-reuses"
description: "Verdict: should-fix (follow-up), severity low.\n\nScenario: a branch's PR base `layer` is cached by an expanded strip's GitHub read. The PR then merges or closes. The next expanded read gets \"no pull requests found\", so collectBranchHealth correctly ignores the cache (F2 fix, 5af6db8a) and compares against the upstream or default. But the PrBaseCache entry stays. The Workspaces board's next mount does a local-only read (localOnly: true, lookup null), and mayUseCachedBase(null) returns true. The strip goes back to `baseSource: \"pr-cached\"` against the stale `layer`. nextLayer does the same for a stack layer.\n\nEvidence: packages/web/src/server/branch-health/collect.ts. In collectBranchHealth, cachedBase is used when mayUseCachedBase(lookup) is true; in nextLayer, the cache is read in the `else if (mayUseCachedBase(found))` branch. PrBaseCache has no delete.\n\nReachable: GET /api/branch-health without ?github=1 after a ?github=1 read answered no-PR. The cached base did the same before F2, so this is a gap the F2 fix exposed, not a regression.\n\nFix options:\n(a) Recommended. Add PrBaseCache.delete(projectDir, branch). Call it when viewPr answers noPr, both for the branch in collectBranchHealth and for each layer in nextLayer. Cost: a few lines and one test. Risk: none known.\n(b) Store the time each base was cached and expire entries. More code, and it still serves a stale base until expiry."
acceptanceCriteria:
  - "After a GitHub read whose gh pr view answers 'no pull requests found' for the branch, a following local-only read does not report baseSource 'pr-cached' for that branch (integration test with a gh stub)"
  - "The same holds for a stack layer: a layer gh reports has no PR is no longer named from the cache by a later local-only read (tested)"
  - "A gh failure (offline, expired token) still leaves the cached entry in place (existing test keeps passing)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
