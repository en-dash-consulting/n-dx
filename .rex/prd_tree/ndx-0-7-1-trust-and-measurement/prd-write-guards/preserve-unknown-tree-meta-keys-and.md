---
id: "ae26c118-df76-4f51-8893-e772f38b2cc3"
level: "task"
title: "Preserve unknown tree-meta keys and treat a missing marker as a failure once one has been adopted"
status: "in_progress"
priority: "high"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2092"
  - "pr-j2"
source: "caos work management: WM2092 (Preserve unknown tree-meta keys and treat a missing marker as a failure once one has been adopted); follow-up from the guards run 2026-09-22, PR group J2"
startedAt: "2026-09-22T19:04:06.340Z"
acceptanceCriteria:
  - "Writing tree-meta.json through any rex path preserves keys the writer does not know (unit test with an extra key)."
  - "On a tree with no marker, rex validate fails with 'slug rule marker missing; run rex migrate-slugs', and the hench and Execute gates refuse the same way."
  - "rex migrate-slugs on a conformant tree with no marker records it and reports slugRuleRecorded."
  - "A fresh rex init writes the marker, so new projects never hit the missing case."
description: "Observed live: a rex MCP server started before the rebuild rewrote .rex/tree-meta.json without slugRule, erasing the marker, because the sidecar is rewritten wholesale from a type that has no such field. Older builds share the same slug rule so they cannot re-slug, but they silently disarm the guard for whoever writes next. Two changes: every tree-meta write in new builds reads the existing file and preserves keys it does not know, so this cannot happen again between future versions; and a missing marker is no longer 'adopt silently' once the repository has recorded one: rex validate reports it as an error, the hench and Execute pre-gates refuse, and the fix is to run rex migrate-slugs, which re-records the marker after verifying the tree. Builds already deployed cannot be changed; the 0.7.1 publish retires them.\n\nImplementation notes: In packages/rex/src/store/tree-meta.ts make the write helper read the current file and spread unknown keys into the object it writes. Change the absent-marker branch in the save guard (packages/rex/src/store/slug-rule-guard.ts and folder-tree-store.ts adoptSlugRule) so that absence is refused with a message naming rex migrate-slugs rather than adopted silently, except inside rex init and rex migrate-slugs which write the marker deliberately. Make rex validate report absence as an error and confirm the hench pre-run gate and the web Execute route surface the same refusal. Tests for preservation, refusal, init and migrate-slugs. Changesets: @n-dx/rex patch, @n-dx/hench patch, @n-dx/web patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T19:04:06.712Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
