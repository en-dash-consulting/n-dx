---
id: "a127abde-ad1d-4688-bc87-2ab8ea3117d9"
level: "task"
title: "`ndx ci` fails any user project that imports child_process: its allowlist only names n-dx's own files and cannot be configured"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`ndx ci` on a project that is not the n-dx monorepo and imports child_process in production code does not fail its architecture-policy step"
  - "`ndx ci .` on the n-dx monorepo still enforces the child_process allowlist from packages/core/child-process-allowlist.json"
  - "A test runs checkArchitecturePolicy (or runCI) against a fixture user project that imports child_process and asserts the step does not fail"
description: "Verdict: out-of-scope (pre-existing; found while reviewing a96f0d51, which moved the list into packages/core/child-process-allowlist.json without changing who it applies to). Severity medium.\n\nFailure: `checkArchitecturePolicy(dir)` (packages/core/ci.js, step 3c of runCI) scans the target project with an allowlist of n-dx monorepo paths. In any other repository, every production file that imports node:child_process is a violation, `ndx ci` reports `CI pipeline failed.`, and no project config can permit it. Reproduced: a fixture project holding only scripts/release.js with `import { execFileSync } from \"node:child_process\"` returns `{ ok: false, checked: 1, violations: [\"scripts/release.js\"] }`.\n\nReachable: `ndx ci [dir]` in any user project. The four-tier spawn rule is n-dx's own architecture, not a rule user projects opted into.\n\nOptions:\n1. (Recommended) Run the step only when the target is the n-dx monorepo, or when the project opts in. Cost: small. Risk: none for user projects.\n2. Let `.n-dx.json` declare extra allowed paths. Cost: medium; keeps a rule users never asked for.\n3. Downgrade the step to a warning outside n-dx. Cost: small; still noise."
lastModified: "2026-10-07T03:53:20.253Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
