---
id: "6ae69b1a-5f7b-4306-a411-30a1fe7908f3"
level: "task"
title: "Title lint rejects dependency versions such as \"Upgrade zod to 3.25.76\" as release tokens"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-07"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "titleReleaseToken (or the rule) accepts \"Upgrade zod to 3.25.76\" and \"Support Node 22.0.0\""
  - "\"0.8.0 release audit\" and \"PR 12 follow-up\" are still flagged"
  - "Unit tests for both cases exist in packages/rex/tests/unit/schema/v2-rules.test.ts"
description: "Verdict: should-fix (medium).\n\nScenario: a change titled \"Upgrade zod to 3.25.76\" or \"Support Node 22.0.0\" fails title-release-token as an ERROR. The rule exists so that titles do not name the project's own release (for example \"0.8.0 release audit\"). A dependency version is not that, but VERSION_TOKEN matches any three-part number.\n\nEvidence: packages/rex/src/schema/v2-rules.ts, VERSION_TOKEN `\\b(?:v?\\d+\\.\\d+\\.(?:\\d+|x)(?:-[0-9A-Za-z.]+)?|v\\d+\\.\\d+)\\b`. The tests in v2-rules.test.ts cover only release-style titles.\n\nReachable: once health rules run as errors (E7) on the change layer. Dependency bump changes, such as dependabot-style PRs captured as changes, are common.\n\nOptions:\n1. Flag only versions that are not preceded by a dependency-ish context word (to, from, bump, upgrade, a package name). This is heuristic and fragile.\n2. Flag only versions equal to a known release: the project's package version line, or any `plannedRelease`/`shippedIn` in the tree. Precise, but the rule then needs the release list passed in through RuleOptions. Recommended.\n3. Keep matching broadly, but report dependency-like matches as warnings rather than errors.\n\nDecision for the owner: whether the lint means \"names any version\" or \"names one of our releases\"."
lastModified: "2026-10-06T05:34:39.451Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
