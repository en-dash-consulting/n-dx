---
id: "5aa1516c-24e5-463d-a4e2-4d6200e5ed84"
type: "task"
title: "Dependency-directory blocks match at any depth, so a nested node_modules is kept out too"
slug: "dependency-directory-blocks-match-at"
description: "Fix for change a2e189ae, found by the adversarial review of 034517a2 (Hal's #816 F1 follow-up). hench's guard matches blockedPaths anchored at the project root (packages/hench/src/guard/paths.ts simpleGlobMatch), so the baseline's node_modules/**, vendor/**, .build/**, DerivedData/**, Pods/** and Carthage/** block only root-level directories. A write to web/node_modules/.bin/x in a polyglot checkout, or to packages/a/node_modules/x/ in a JS workspace monorepo, passes the untrusted clamp, and the payload runs at the operator's next npm or pnpm. Fix, the review's option (a): the baseline's dependency patterns match at any depth (**/node_modules/** and so on), as SECRET_PATH_PATTERNS already do. Kept in layer 1 by Ryan on 2026-10-27, to run after d17bd9c5."
acceptanceCriteria:
  - "Closes #686 (finding 1, follow-up): a nested dependency directory is kept out of an untrusted checkout as a root one is"
  - "validatePath refuses `web/node_modules/.bin/x` and `packages/a/node_modules/x/package.json` under the guard baseline for every language"
  - "An untrusted polyglot checkout (root go.mod, JS frontend in web/) clamped by applyRepoTrust refuses a write to web/node_modules/ — a test that fails today"
  - "Existing hench init defaults still evaluate as baseline in the trust assessment (no repository flips to untrusted on upgrade)"
  - "d17bd9c5's own-ecosystem check still recognises guards ndx init wrote before this change (root-only patterns) as complete, so no repository flips to untrusted"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
