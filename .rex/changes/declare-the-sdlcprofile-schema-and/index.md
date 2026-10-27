---
id: "91327de0-d951-430d-b93b-0b8f26b69000"
type: "change"
title: "Declare the SdlcProfile schema and register sdlc-profile.json"
slug: "declare-the-sdlcprofile-schema-and"
intent: "Schema first, so the analyzer and the scorecard are written against a settled shape. Add `SdlcProfile` to `packages/sourcevision/src/schema/v1.ts` and `sdlcProfile: \"sdlc-profile.json\"` to `schema/data-files.ts`, following the `ProjectProfile` precedent rather than forking it.\n\nThe load-bearing rule is that nothing is asserted without proof: every detection carries `{ kind, path, line?, excerpt?, confidence: \"certain\" | \"likely\" | \"inferred\" }`. Sections are commands, tests, ci, cd, rollback, migrations, featureFlags, qualityGates, observability, containers and iac.\n\nThe `commands` section is the one with a future beyond this feature — `test-command-resolver.ts`, rex's `.rex/config.json` `test`, and `readme-generator.js` `detectCommands` each discover commands their own way, and this section is meant to be adoptable by all three later. Design it for that; do not rewrite them here."
acceptanceCriteria:
  - "`SdlcProfile` is declared in `schema/v1.ts` with sections for commands, tests, ci, cd, rollback, migrations, featureFlags, qualityGates, observability, containers and iac."
  - "A shared evidence type `{ kind, path, line?, excerpt?, confidence: SdlcConfidence }` is declared once and used by every section; the type makes an evidence-free detection unrepresentable."
  - "The confidence vocabulary is a standalone `\"certain\" | \"likely\" | \"inferred\"` union in `schema/v1.ts`, not literals inlined into the evidence type. Shipped as `SdlcConfidence`. The outbound-dependency task (`21c17d38`) imports the same union for a different record rather than declaring a second one; whoever does that may drop the `Sdlc` prefix, provided there is still exactly one definition."
  - "`sdlcProfile: \"sdlc-profile.json\"` is registered in `schema/data-files.ts` alongside the existing data files."
  - "The `commands` section models test, lint, typecheck, build, deploy and migrate uniformly, each with the manifest or file it came from, so a later consumer can read it as a single source of truth."
touches:
  - "7d36ef27-6a39-42bb-ac8f-39059ac330b2"
priority: "high"
source: "ndx-capture"
---
