---
id: "6e205a2f-3e2e-4813-926b-2e410c44d69c"
type: "change"
title: "graview.bin from the repository's config is spawned without a trust check"
slug: "graview-bin-from-the-repository-s"
intent: "Out-of-scope finding from the adversarial review of 0681b775 (a tracked .n-dx.local.json counts as repository config). Pre-existing, not introduced by that change.\n\nScenario: a cloned repository sets `{\"graview\": {\"bin\": \"./tools/graview\"}}` in `.n-dx.json` (or in a committed `.n-dx.local.json`). The user runs `ndx graview emit .` (or `check`/`serve`/`mcp`) before `ndx trust accept .`. `readGraviewConfig` (packages/graview/src/graview-bin.ts:68-81) reads `bin` from both files with no trust gate, and the binary resolution spawns the repository's script with the user's environment. Every other repository-chosen binary (`*.cli_path`, `hench.claudePath`, `cli.claudePath`, `rex.test`) now applies only once the checkout is trusted; `graview.bin` is the one left out, and `collectRepoExecutionConfig` doesn't list it, so the trust review cannot show it either.\n\nReachable: `ndx graview <sub>` in any checkout whose config sets graview.bin. Not covered: no trust check anywhere in graview-bin.ts.\n\nOptions: (1) recommended: add `graview.bin` to the trust-gated vendor/binary set in llm-client repo-trust (collected and listed as a finding, so it enters the digest), and have graview read it through a gated loader (via its llm-gateway); an untracked `.n-dx.local.json` value keeps applying. Cost: small, with the same shape as the cli_path gate. Risk: a trusted repo that sets it reads as changed once. (2) Read `graview.bin` only from an untracked local config and ignore the shared one. Cheaper, but the trust review still can't show it.\n\nVerdict: out-of-scope (pre-existing). Severity critical on the review scale (a repository-chosen binary runs with the user's environment before trust)."
acceptanceCriteria:
  - "In an untrusted checkout whose .n-dx.json sets graview.bin to a sentinel script, `ndx graview emit .` does not run the script (sentinel-script test fails today)"
  - "A graview.bin in a git-tracked .n-dx.local.json is likewise not run until the checkout is trusted"
  - "The trust review lists a repository-set graview.bin as a finding and it enters the trust digest; accepting it makes the binary run"
  - "A graview.bin in an untracked .n-dx.local.json keeps applying, and NDX_GRAVIEW_BIN keeps working"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "critical"
tags:
  - "ndx-adversarial-review"
  - "severity:critical"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
