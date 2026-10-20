---
id: "4ec5e691-50cc-4b84-b055-b6cd7d09d8b6"
level: "task"
title: "Stop collectTree following symlinks when it bundles a pack"
status: "pending"
priority: "medium"
tags:
  - "review-fixes"
  - "sv-pack"
  - "security"
  - "pr-21"
source: "review"
acceptanceCriteria:
  - "collectTree terminates on a directory containing a symlink loop"
  - "A symlink whose target is outside the bundled root never puts that target's contents in the bundle"
  - "A bundle built from a normal npm install prefix is unchanged, and the docstring describes the link behaviour"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "**should-fix (low-medium).** Review: Hal on #772 (F2), 2026-10-20.\n\n`packages/sourcevision/src/cli/commands/pack-archive.ts:38-54`: `collectTree` walks with `statSync`, so it follows symlinks, and keeps no visited set and no depth bound. A symlink loop under the staged prefix recurses until the stack or path limit stops it, and a symlink pointing out of the tree copies its target's contents into a bundle that is then handed to colleagues. The normal input (a fresh `npm install --prefix <tmp>`) has no links, which is why this has not bitten, but an npm package may ship symlinks.\n\nFix: use `lstatSync` and skip symlinks (recording each skipped link so `sv pack bundle` can say so), unless following them is needed for a pnpm-shaped prefix, in which case track `realpath`s in a visited set and refuse a link whose target is outside the root. Update the docstring, which currently says links are followed. Add a test with a link loop and a link out of the tree. Add a `@n-dx/sourcevision` patch changeset."
lastModified: "2026-10-20T14:42:19.612Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
