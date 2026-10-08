---
id: "aefd4c7f-fc33-4522-b13b-917058918ae5"
level: "task"
title: "Adapt status, edges and the retired-commits tests to PR 30's schema and rules"
status: "pending"
priority: "critical"
description: "Run first after the PR 30 merge (merge commit bc35bb8c3), which left this branch red. Goal: rex typechecks and every rex test passes, with no behaviour beyond what PR 30 requires. Decided 2026-10-07 (Ryan, option B).\n\n- core/product-status.ts imports specOf, which PR 30 replaced with a private nodeSpec in schema/v2-rules.ts. Export nodeSpec from v2-rules.ts (additive, unchanged) and use it; do not reintroduce specOf.\n- Two tests use fixtures that PR 30's stricter ref-resolves now flags (references that name no node): tests/unit/schema/v2-rules.test.ts, retired-state-field: warns on a node that still carries stored commits; and tests/unit/store/state-writer.test.ts, round-trip: loads a state.yaml that still carries retired commits. Give their fixtures references that resolve (or a valid target), so each test asserts only the retired-state-field finding it is about. Do not weaken ref-resolves.\n- Check core/product-edges.ts and core/product-status.ts against the shared isOpenChange/isAppliedChange from v2-rules.ts: where they keep a local applied or open definition (for example isAppliedChange counting a completed status), switch to the shared predicates only if a test fails without it; the semantic switch itself belongs to 9eed16cc and bd27f348.\nPatch changeset for @n-dx/rex only if public behaviour changes."
lastModified: "2026-10-08T03:22:21.269Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
