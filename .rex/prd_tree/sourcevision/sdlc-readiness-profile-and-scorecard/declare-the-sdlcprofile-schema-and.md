---
id: "91327de0-d951-430d-b93b-0b8f26b69000"
level: "task"
title: "Declare the SdlcProfile schema and register sdlc-profile.json"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "`SdlcProfile` is declared in `schema/v1.ts` with sections for commands, tests, ci, cd, rollback, migrations, featureFlags, qualityGates, observability, containers and iac."
  - "A shared evidence type `{ kind, path, line?, excerpt?, confidence: Confidence }` is declared once and used by every section; the type makes an evidence-free detection unrepresentable."
  - "`Confidence` is a standalone `\"certain\" | \"likely\" | \"inferred\"` union in `schema/v1.ts`, not literals inlined into the evidence type. The outbound-dependency task (`21c17d38`) uses the same union for a different record, and the two must not end up with separate definitions: declare `Confidence` if it is not there when you start, and import the existing one if it is."
  - "`sdlcProfile: \"sdlc-profile.json\"` is registered in `schema/data-files.ts` alongside the existing data files."
  - "The `commands` section models test, lint, typecheck, build, deploy and migrate uniformly, each with the manifest or file it came from, so a later consumer can read it as a single source of truth."
description: "Schema first, so the analyzer and the scorecard are written against a settled shape. Add `SdlcProfile` to `packages/sourcevision/src/schema/v1.ts` and `sdlcProfile: \"sdlc-profile.json\"` to `schema/data-files.ts`, following the `ProjectProfile` precedent rather than forking it.\n\nThe load-bearing rule is that nothing is asserted without proof: every detection carries `{ kind, path, line?, excerpt?, confidence: \"certain\" | \"likely\" | \"inferred\" }`. Sections are commands, tests, ci, cd, rollback, migrations, featureFlags, qualityGates, observability, containers and iac.\n\nThe `commands` section is the one with a future beyond this feature — `test-command-resolver.ts`, rex's `.rex/config.json` `test`, and `readme-generator.js` `detectCommands` each discover commands their own way, and this section is meant to be adoptable by all three later. Design it for that; do not rewrite them here."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-07T16:13:26.622Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
