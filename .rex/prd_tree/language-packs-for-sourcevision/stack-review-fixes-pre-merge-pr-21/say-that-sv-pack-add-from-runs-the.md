---
id: "53d52706-d023-4440-8fad-19717c3eb554"
level: "task"
title: "Say that sv pack add --from runs the bundle's entry module while validating it"
status: "pending"
priority: "low"
tags:
  - "review-fixes"
  - "sv-pack"
  - "security"
  - "pr-21"
source: "review"
acceptanceCriteria:
  - "pack.ts's docstring and the sv pack docs say that validating a --from bundle executes its entry module"
  - "npx vitepress build docs passes"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "**should-fix (low).** Review: Hal on #772 (F3), 2026-10-20.\n\n`packages/sourcevision/src/cli/commands/pack.ts:16` says `add --from <bundle>` \"installs the pack and its dependency closure with no npm call\", which reads as the safer of the two install paths. But `addFromBundle` extracts to a staging directory and calls `loadPack(pack, { packDir: stage, … })`, which dynamically imports the bundle's entry module and runs its top level before anything is installed. That is the right way to validate; the documentation should just say so.\n\nFix: one sentence in the module docstring and in the `sv pack` section of docs/packages/sourcevision.md (and the `--from` help text if it makes the same claim): validating a bundle executes its entry module, so only add bundles from a trusted source. Keep any inline `<placeholder>` off a line start (VitePress parses it as HTML); verify with `npx vitepress build docs`."
lastModified: "2026-10-20T14:42:20.757Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
