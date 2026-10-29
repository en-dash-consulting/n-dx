---
id: "083c929b-aba3-402d-8a5f-9c69dfaa0126"
type: "task"
title: "A repository's graview.bin is not spawned until the checkout is trusted"
slug: "a-repository-s-graview-bin-is-not"
description: "Fix for change 6e205a2f, found by the adversarial review of the 0681b775 retry (run e390f87e). readGraviewConfig (packages/graview/src/graview-bin.ts) takes graview.bin from the shared .n-dx.json and from .n-dx.local.json with no trust gate, and ndx graview emit|check|serve|mcp spawns it with the user's environment. Every other repository-chosen binary (llm.*.cli_path, hench.claudePath, cli.claudePath) is gated since d6282743, e1684072 and fd5f6116; graview.bin is the last one. Fix, the review's option 1: graview.bin joins llm-client's trust-gated binary fields (collected, a vendor-cli-path style finding, in the digest), and graview reads it through the gated path, so a shared value applies only once trusted and a tracked .n-dx.local.json counts as repository config (0681b775). An untracked .n-dx.local.json value and NDX_GRAVIEW_BIN keep working. Keep the graview package's own dependency rules (it has no @graview/* dependency; check how it reaches llm-client before adding an import). Kept in layer 2 by Ryan on 2026-10-27; runs last, after f11618dd."
acceptanceCriteria:
  - "Closes #635 (follow-up): no binary path a repository ships, graview.bin included, is spawned while the repository is untrusted"
  - "In an untrusted checkout whose .n-dx.json sets graview.bin to a sentinel script, `ndx graview emit .` does not run the script (sentinel-script test fails today)"
  - "A graview.bin in a git-tracked .n-dx.local.json is likewise not run until the checkout is trusted"
  - "The trust review lists a repository-set graview.bin as a finding and it enters the trust digest; accepting it makes the binary run"
  - "A graview.bin in an untracked .n-dx.local.json keeps applying, and NDX_GRAVIEW_BIN keeps working"
  - "This repository's own trust state does not change"
  - "Tests fail on the code before the fix"
priority: "critical"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
