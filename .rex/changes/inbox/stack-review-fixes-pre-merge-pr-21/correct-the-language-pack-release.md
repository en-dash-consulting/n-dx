---
id: "f9f5708a-fc3a-44af-ad4b-68f45311414c"
type: "task"
title: "Correct the language-pack release notes before the stack merges"
slug: "correct-the-language-pack-release"
description: "**should-fix (release notes).** Reviews: https://github.com/en-dash-consulting/n-dx/pull/822#pullrequestreview-5559040488 (stale detection rule; fingerprint not described) and https://github.com/en-dash-consulting/n-dx/pull/825#pullrequestreview-5559040931 (\"linear on any input\" claim).\n\nAt the #825 head:\n\n1. **Stale detection rule.** `.changeset/sv-terraform-inventory.md:5` says \"Terraform is the primary language only when no other language marker matches\", and `.changeset/sv-terraform-zones-detection-roles.md:7` says \"Terraform is a secondary language unless nothing else matches\". Since #822, a markerless repository with any JS/TS (or other source the TypeScript fallback is for) keeps TypeScript primary with Terraform secondary; Terraform is primary only when there is no fallback source at all (and never beside Java). Amend both sentences. If the detection task in this feature changes the rule, describe the final rule.\n\n2. **Inventory fingerprint not described.** None of the stack's changesets mentions it, but users see it: `packages/sourcevision/src/cli/commands/analyze-phases.ts:67` (`INVENTORY_FINGERPRINT_FILE = \"inventory-fingerprint.json\"`) means the first incremental analyze after upgrading rebuilds the whole inventory, and `.sourcevision/.cache/inventory-fingerprint.json` appears (machine-local, safe to delete; `--full` or a missing fingerprint also rebuilds). Add a new `\"@n-dx/sourcevision\": patch` changeset saying so. Check whether docs/architecture/generated-files.md lists `.sourcevision/.cache/` files; if it lists them one by one, add this one.\n\n3. **Overclaim.** `.changeset/java-build-file-reads-bounded.md:5` says \"The Java build file readers now run in linear time on any input\". The re-review measured quadratic paths still present under the 1 MiB cap (`stripXmlComments`, `discoverJavaModules`' Gradle include/srcDir regexes, `readGradleBuildModels`' `continues()`), deferred to issue #826. Reword to what is true: the listed pathological inputs (missing closing tag with long whitespace, unterminated `<!--`, unclosed blocks, unterminated `/*`) no longer take seconds, and a build file over 1 MiB is skipped with a notice. Do not claim linear time.\n\nChangesets default to patch and use scoped names (CLAUDE.md)."
acceptanceCriteria:
  - "sv-terraform-inventory.md and sv-terraform-zones-detection-roles.md state the shipped rule: with no marker, TypeScript stays primary and Terraform is secondary whenever there is any fallback source; Terraform is primary only with none"
  - "A new @n-dx/sourcevision patch changeset says the first incremental analyze after upgrading rebuilds the whole inventory and that .sourcevision/.cache/inventory-fingerprint.json appears"
  - "java-build-file-reads-bounded.md no longer claims linear time on any input, and claims only what the stack delivers"
  - "pnpm changeset status passes; every changeset uses scoped package names and patch bumps"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "review-fixes"
  - "release-notes"
  - "changesets"
  - "pr-21"
source: "review"
---
