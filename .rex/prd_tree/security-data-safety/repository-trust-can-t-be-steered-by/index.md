---
id: "346e0812-443a-4ae2-96e4-be96607b7d97"
level: "feature"
title: "Repository trust can't be steered by the repository"
status: "pending"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #686 (findings 1, 2 and 4); #686 itself stays open until layer 2 merges"
  - "Each fix has a test that fails on origin/main 9f6a0e963 and passes with the fix"
description: "Layer 1 of 2 for the open findings in #686 (from the #490/#491 adversarial reviews). Three of the four still reproduce on origin/main 9f6a0e963 against the built code (re-checked 2026-10-16): a checkout picks its own trust baseline (finding 1), a plain repository test command runs from verify_criteria before trust (finding 2), and the trust inventory follows symlinked directories (finding 4). Layer 2, \"Every child process gets the sanitized environment\", takes finding 3 and #635. Branch fix/security-repo-trust; PR title \"Repository trust can't be steered by the repository (security 1/2)\". Out of scope here: packages/sourcevision (lang-kit stack), rex migrations and the folder-tree parser, and the rex MCP tools get_capabilities and get_product (v2 migrate stack)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:27:38.961Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [`ndx trust accept .` tells a user with a repository test command there is "Nothing to trust"](./ndx-trust-accept-tells-a-user-with-a.md) | pending |
| [The trust baseline comes from host-side detection, never from the repository's declared language](./the-trust-baseline-comes-from-host.md) | completed |
| [The trust inventory never follows a symlinked directory out of the repository](./the-trust-inventory-never-follows-a.md) | pending |
| [verify_criteria runs a repository's test command only once its digest is accepted](./verify-criteria-runs-a-repository-s.md) | completed |
