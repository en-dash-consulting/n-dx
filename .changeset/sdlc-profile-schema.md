---
"@n-dx/sourcevision": patch
---

Declare the `SdlcProfile` schema and register `sdlc-profile.json`.

Evidence-based CI/CD maturity for a repository: sections for commands, tests, ci, cd, rollback, migrations, featureFlags, qualityGates, observability, containers and iac. Every detection carries at least one piece of evidence — `{ kind, path, line?, excerpt?, confidence }` — and `SdlcEvidenceList` is a non-empty tuple, so a detection with no proof does not compile. The validator enforces the same rule at the boundary for profiles written by anything else.

The `commands` section models test, lint, typecheck, build, deploy and migrate uniformly, shaped so `test-command-resolver.ts`, rex's `.rex/config.json` `test` key and `readme-generator.js`'s `detectCommands` can adopt it later. Nothing is wired to it here — the analyzer and the scorecard are separate work.
