---
id: "da77bb00-e07f-4e64-8f47-0edfd6db5e43"
type: "change"
title: "Versioned analysis files: schemaVersion on each fact file, the packs that ran, and a stated compatibility promise"
slug: "versioned-analysis-files-schemaversion"
summary: "Tools built on n-dx read its analysis files, but most of those files do not say which shape they are in, and nothing says which shapes will stay stable. Label every file with its version, record which language packs produced it, and write down the promise, so other tools can depend on the files safely."
intent: "Reported by a downstream tool that reads sourcevision's analysis files for many repositories (checked against 0.10.5).\n\n- **No version on most fact files.** Only manifest.json, project-profile.json and sdlc-profile.json carry schemaVersion (packages/sourcevision/src/schema/v1.ts). imports.json, config.json, outbound.json, readiness.json, components.json and legacy.json do not, so a reader has to pin each shape to an n-dx commit and fail on anything else.\n- **The ecosystem key is undocumented.** sdlc-profile and readiness key `ecosystem` by pack id (`php`) while inventory.json names languages (`PHP`).\n- **A clean parse and an unreported one look the same.** imports.json `summary.parseIssues` is \"absent when every pack-parsed file parsed cleanly\", and analyses made before the field existed also leave it out.\n- **No record of the packs.** manifest.json does not say which language packs ran or their versions; the only evidence is inventory.json `summary.analysedLanguages`.\n- **No stated promise.** docs/architecture/public-surface.md declares PRD, MCP, bundle, layout and attribution surfaces but not the analysis files. `sv readiness --json` exists but nothing says its shape is stable.\n- **Extensions.** docs/extensions/versioning.md says a minor may break the extension contract, and extensions pin `ndxVersion` below the next minor (for example `<0.12.0`). Authors need to know, ahead of a minor, whether it changes `ndx.extension`.\n\nAll changes are additive (new optional fields, and a doc). Patch changesets for @n-dx/sourcevision and any pack touched."
acceptanceCriteria:
  - "Every analysis fact file sourcevision writes carries a schemaVersion"
  - "manifest.json lists the language packs that ran with their versions"
  - "imports.json parseIssues has an entry, zero counts included, for every pack that ran, and none for a pack that did not"
  - "public-surface.md declares the analysis files as a surface with its status, the schemaVersion rule and the ecosystem key"
  - "docs/extensions/versioning.md states whether the next minor changes the ndx.extension contract"
touches:
  - "b9d3a37a-9227-4a10-87ba-de286cec7fac"
  - "7d36ef27-6a39-42bb-ac8f-39059ac330b2"
priority: "high"
tags:
  - "sourcevision"
  - "schema"
  - "public-surface"
source: "ndx-capture"
---
