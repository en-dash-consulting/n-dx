---
id: "03ff459b-c056-4fe1-9aa3-9f0d118c99bb"
level: "task"
title: "Remove the dead omitSlugRuleMarker option or reach it from a CLI fixture"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2093"
  - "pr-j2"
source: "caos work management: WM2093 (Remove the dead omitSlugRuleMarker option or reach it from a CLI fixture); follow-up from the guards run 2026-09-22, PR group J2"
acceptanceCriteria:
  - "omitSlugRuleMarker no longer exists, or a CLI-level test uses it."
  - "The absent-marker branch keeps a test that reaches it."
description: "writePRD's omitSlugRuleMarker option is referenced only at its own definition and single use; no CLI-level fixture reaches the absent-marker branch, so that branch is covered at the store level only. Either remove the option and cover the branch through a store-level fixture that writes tree-meta.json without the marker directly, or add the CLI-level fixture that needs it. Prefer removal.\n\nImplementation notes: Search packages/rex/src for omitSlugRuleMarker; remove the option and its plumbing, and replace any test that relied on it with a fixture that writes a tree-meta.json lacking the marker directly on disk. Changeset: @n-dx/rex patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:48:02.417Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
