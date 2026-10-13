---
id: "ec304126-be59-4fd3-8f70-ed1da11eaa4f"
level: "task"
title: "infrastructure.ts header says only node: builtins may be imported, but it now imports IAC_KINDS from @n-dx/lang-kit"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-kit"
  - "pr-11"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The import-constraints paragraph in packages/sourcevision/src/analyzers/infrastructure.ts names @n-dx/lang-kit (IAC_KINDS) as the one allowed package import and says that build-iso-skill.mjs aliases it to src/iac-kinds.ts"
  - "The header no longer says that only node: builtins and type-only imports may appear"
  - "The doc comment near infrastructure.ts:465 that points at `language/terraform.ts` names `@n-dx/lang-kit`'s terraform module instead (it moved in b4bb436a; review of run e70597e0, low)"
  - "Comment-only: `git diff` on infrastructure.ts touches no code line, `node scripts/build-iso-skill.mjs --check` passes or the operator regenerates the script"
description: "Verdict: should-fix (low). Found by the adversarial review of 4a1a2c31.\n\npackages/sourcevision/src/analyzers/infrastructure.ts:27-35 (\"Two constraints on what this module may import\") says only `node:` builtins and type-only imports may appear, because the file bundles into the standalone iso-map skill. Since 4a1a2c31, line 42 is a runtime `import { IAC_KINDS } from \"@n-dx/lang-kit\"`. That works only because scripts/build-iso-skill.mjs aliases @n-dx/lang-kit to packages/lang-kit/src/iac-kinds.ts. Nothing fails today. The risk is that the next editor trusts the comment, or adds a second lang-kit import, without knowing the alias limits it to iac-kinds.ts. The bundle build then fails on the missing export, which is the intended guard, but the comment gives the wrong explanation.\n\n4a1a2c31 could not fix this: its acceptance criteria limit the infrastructure.ts diff to the import line and the removed table. The same header also still says the iac logic lives here, and an earlier review noted the comment points at language/terraform.ts.\n\nFix (recommended): reword the header so it lists the allowed imports as `node:` builtins, type-only imports, and `IAC_KINDS` from @n-dx/lang-kit, which build-iso-skill.mjs aliases to iac-kinds.ts alone. Cost: comment only. Risk: none."
lastModified: "2026-10-13T04:17:33.043Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
