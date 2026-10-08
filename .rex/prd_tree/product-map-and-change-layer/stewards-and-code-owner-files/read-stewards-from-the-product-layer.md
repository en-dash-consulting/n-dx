---
id: "1e556ade-c4a9-443a-93e5-d87e5d409a45"
level: "task"
title: "Read stewards from the product layer and generate code-owner files per host"
status: "in_progress"
priority: "medium"
tags:
  - "pr-25"
  - "lane-core-docs"
  - "rex"
  - "core"
source: "roadmap"
startedAt: "2026-10-08T15:15:01.925Z"
acceptanceCriteria:
  - "Both files are generated from one stewards list (tests)"
  - "Touches-only changes match no code-owner rule"
  - "Generation is opt-in"
description: "stewards: on the root product/index.md with optional per-area override; entries are git emails with optional GitHub or Bitbucket handle and group aliases. Opt-in generation of CODEOWNERS (GitHub) and .bitbucket/CODEOWNERS (Bitbucket) mapping each area folder to its stewards, regenerated when the lists change.\n\n## Decision and operator note (Ryan, 2026-10-08)\n\nScope is option A: a stewards entry is a plain string, exactly as packages/rex/src/schema/v2.ts declares (`Steward = string`): a git email, or a GitHub-style team handle `@org/team`. Per-host handles and group aliases are deferred to a later, additive optional field; do not build them here and do not add undeclared fields to the root header or to area intent.\n\n- Read `stewards` from the root product index (RootHeader) as the default, with an area's own `stewards` overriding it for that area's folder.\n- Generate both files from that one list: CODEOWNERS (GitHub) and .bitbucket/CODEOWNERS (Bitbucket), one rule per area folder. Emails go in both files. A `@org/team` handle is GitHub syntax, so it goes in the GitHub file only; the Bitbucket file omits it and generation prints a warning naming each omitted handle.\n- Opt-in: nothing is generated unless the project turns it on; regenerate when the lists change.\n- Touches-only changes write nothing under the product layer, so no generated rule may match a path outside the product-layer area folders.\n- Do not edit packages/rex/src/core/, packages/rex/src/schema/v2.ts or packages/rex/src/schema/v2-rules.ts. Orchestration scripts in packages/core spawn CLIs and never import packages (config.js is the only exception).\n- The sandbox pre-approves only npm, npx, node, git, tsc and vitest commands; use those forms (e.g. `npx vitest run …`), never pnpm."
lastModified: "2026-10-08T15:15:02.774Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
