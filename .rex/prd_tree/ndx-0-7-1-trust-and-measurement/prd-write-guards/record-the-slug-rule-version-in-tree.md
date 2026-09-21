---
id: "5c09a992-afdb-4ca0-8c0a-2d52569289d6"
level: "task"
title: "Record the slug rule version in tree-meta.json and refuse writes from a build with a different rule"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "wm-2081"
source: "caos work management: WM2081 (Record the slug rule version in tree-meta.json and refuse writes from a build with a different rule); guards PR, front of 0.7.1 wave 1"
acceptanceCriteria:
  - "A save against a tree whose slugRule differs from the build's constant throws before writing any file, and the message names both versions and rex migrate-slugs."
  - "A save against a conformant tree with no marker writes the marker; against a non-conformant tree with no marker it refuses."
  - "rex migrate-slugs rewrites the tree and sets the marker in one run; a second run is a no-op."
  - "A unit test pins the expected slugs for a fixture so any change to the rule functions fails until SLUG_RULE_VERSION is bumped and the fixture updated."
  - "rex validate reports a marker mismatch as an error; reading tree-meta.json with the extra key is unchanged for the parser."
description: "The tree carries no record of which slug rule wrote it, so a stale or foreign rex build that disagrees with the rule cannot know it is about to rewrite every path. .rex/tree-meta.json holds {title, schema} today (packages/rex/src/store/tree-meta.ts, filename constant in store/paths.ts). Add a slugRule integer beside them, sourced from one SLUG_RULE_VERSION constant declared next to the rule functions in packages/rex/src/store/folder-tree-serializer.ts. On every save the serializer compares the marker to its constant: different means refuse the whole save and leave the tree untouched, naming both versions and rex migrate-slugs; absent means write the marker if the tree is conformant, otherwise refuse. rex migrate-slugs becomes the one command that sets the marker to the current version. Older builds ignore the unknown key, so a tree with the marker still loads everywhere; the guard protects every build from this one forward.\n\nImplementation notes: Add SLUG_RULE_VERSION (start at 2) beside slugifyTitle, resolvePositionalSiblingSlugs and appendShortIdSuffix in packages/rex/src/store/folder-tree-serializer.ts. Extend the tree-meta type and read/write helpers in packages/rex/src/store/tree-meta.ts with an optional slugRule number, tolerated when absent. In the save path (folder-tree-store.ts saveDocument / withTransaction, before any file is written) read the marker: mismatch → throw a typed error naming both versions and 'rex migrate-slugs'; absent → run findNonConformingSlugs and either write the marker or throw the same error. Make packages/rex/src/cli/commands/migrate-slugs.ts write the marker after its lossless swap. Add the marker check to rex validate as an error. Tests: mismatch refuses and leaves the fixture byte-identical; absent-and-conformant writes the marker; migrate-slugs sets it; a fixture-slug pin test that fails when the rule changes without a version bump. Note for later: the 1.0.0 storage change moves tree-meta.json into the root index.md frontmatter, so keep the marker a named field that can move with it, and note that hench's completion commit stages tree-meta.json so the marker write is committed with the first save. Changeset: @n-dx/rex patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T18:55:28.291Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
