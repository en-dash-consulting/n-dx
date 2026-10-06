---
id: "7d36ef27-6a39-42bb-ac8f-39059ac330b2"
level: "feature"
title: "SDLC readiness profile and scorecard: evidence-based CI/CD maturity for agent readiness"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "`SdlcProfile` is declared in `packages/sourcevision/src/schema/v1.ts` and `sdlcProfile: \"sdlc-profile.json\"` is registered in `schema/data-files.ts`."
  - "Every detection carries evidence shaped `{ kind, path, line?, excerpt?, confidence: \"certain\" | \"likely\" | \"inferred\" }`; no detection is recorded without at least one evidence entry."
  - "The profile has sections for commands, tests, ci, cd, rollback, migrations, featureFlags, qualityGates, observability, containers and iac, each populated by its own detector."
  - "The `commands` section reports test, lint, typecheck, build, deploy and migrate commands sourced from package manifests, Makefile, pyproject and go.mod, in a shape a later consumer could adopt as the single source of truth."
  - "The `tests` section reports a unit/integration/e2e taxonomy, the runners found, coverage configuration, and an approximate test-to-source ratio."
  - "The `ci` section reports provider, triggers, and jobs classified as test, build, deploy or release, plus protected branches when a CODEOWNERS or branch-protection file exists."
  - "The `cd` section reports deploy targets, environments, and a rolling/canary/blue-green strategy derived from Argo Rollouts, Flagger, CodeDeploy, k8s manifests or Helm values."
  - "The `rollback` section reports versioning scheme, tagged releases, whether down-migrations are present, and any rollout-history tooling."
  - "The `migrations` section detects Prisma, Knex, Drizzle, TypeORM, Alembic, Flyway, Liquibase, Rails, golang-migrate and raw SQL directories."
  - "The `featureFlags` section detects LaunchDarkly, Unleash, OpenFeature, Statsig, GrowthBook, PostHog and Flagsmith, plus env-var flag conventions."
  - "`analyzers/sdlc-profile.ts` walks the repo under its own bounded traversal — respecting `.gitignore` and `.sourcevisionignore`, skipping `node_modules` and vendored directories, capping depth and file count, and never reading a file over 1 MB — and the inventory's `codeOnly` filter is left unchanged."
  - "CI definitions parse into steps for GitHub Actions, GitLab CI, CircleCI and Bitbucket, with Jenkinsfile handled heuristically; a present-but-unparseable provider file is reported as a parse failure with its path, never as absence."
  - "Output is deterministic and canonically ordered via `util/sort.ts`; two runs over an unchanged repo produce byte-identical files."
  - "The analyzer is wired into `cli/commands/analyze.ts` beside the project profile, so every analyze writes `sdlc-profile.json`."
  - "The deterministic result requires no LLM and no network call; where the existing `analyzers/enrich-judge.ts` cascade refines an ambiguous judgement, the deterministic result still stands alone and unchanged when no key is present."
  - "`analyzers/readiness-score.ts` produces `ReadinessScore { overall, dimensions: Record<name, { score, weight, evidence[], gaps[] }>, suggestions[] }` following the weighted shape of `packages/rex/src/core/health.ts`."
  - "Dimension weights live in one exported constant — testing 0.20, ci 0.15, cd 0.15, rollback 0.10, migrations 0.10, featureFlags 0.05, qualityGates 0.10, observability 0.05, agentSafety 0.10 — and are not duplicated anywhere else."
  - "The `agentSafety` dimension is fed by `packages/llm-client/src/repo-trust.ts` findings, which are referenced rather than moved or modified."
  - "Every gap states what evidence would raise the score, not merely that something is missing."
  - "`sourcevision readiness [--json]` exists as a CLI command with help registered in `cli/help.ts`."
  - "`ndx readiness` is registered in `COMMAND_DISPATCH` in `packages/core/cli.js` as a spawn-based passthrough following the existing delegate pattern; core gains no imports."
  - "`get_readiness` is exposed as an MCP tool in `cli/mcp.ts` and returns the same artifact the CLI prints."
  - "The new types reach web only as re-exports through `packages/web/src/server/domain-gateway.ts`, with no logic added there."
  - "`readiness: { overall, analyzedAt }` appears on the sv status in `packages/web/src/server/routes-status.ts`; a dashboard view is not built in this work."
  - "Fixtures exist under `packages/sourcevision/tests/fixtures/` for at least a Node repo with GitHub Actions deploying via Helm with Prisma migrations and LaunchDarkly, a Go repo with GitLab CI and no tests, and an empty repo."
  - "Unit tests in `packages/sourcevision/tests/unit/analyzers/` assert exact scores for each fixture, so any weight change has to be made deliberately."
  - "One e2e test proves `sv analyze` writes `sdlc-profile.json`."
  - "`docs/packages/sourcevision.md` and `docs/guide/commands.md` document the command and artifacts, mark the scorecard as heuristic, and list every detector in a table."
  - "A changeset exists with patch bumps for `@n-dx/sourcevision`, `@n-dx/core` and `@n-dx/web` (scoped names only)."
  - "Nothing under `packages/rex/` or `packages/hench/` changes."
description: "`ndx analyze` answers \"how is this code structured\" but not \"how ready is this repo to be worked by an autonomous agent?\" That is effectively a CI/CD maturity evaluation: tests, automated CI, automated CD, deployment and rollback patterns, data migrations, traffic shifting, feature toggles, quality gates, observability. The output must be evidence-based, scored, and consumable by the CLI, the MCP server, the dashboard, and later by `ndx recommend`.\n\nTwo artifacts, kept separate: a deterministic `sdlc-profile.json` of what was detected, and a `ReadinessScore` computed from it. Detection and judgement do not get mixed.\n\nWhat already exists and must be reused rather than forked:\n- `analyzers/project-profile.ts` already detects frameworks, CI surfaces, build surfaces and release infrastructure by file existence, writes `.sourcevision/project-profile.json`, and is built in `cli/commands/analyze.ts`. Extend that pattern; the new analyzer sits beside it.\n- The inventory's `codeOnly` filter (`analyzers/inventory.ts`) defaults to true and drops YAML, JSON, TOML, Dockerfile and `.tf` files. Do **not** widen the inventory — it would pollute zone detection. The new analyzer gets its own bounded walk, as `project-profile.ts` and `export/iso-declared.ts` already do.\n- `export/iso-declared.ts` already parses Terraform and CloudFormation resources. Reuse it.\n- `packages/rex/src/core/health.ts` is the scorecard pattern to copy: weighted dimensions scored 0-100, overall as the weighted sum, suggestions aimed at the weakest dimension. Keeping the same shape lets the dashboard render both identically.\n- `packages/llm-client/src/repo-trust.ts` already judges agent config safety. Reference its findings as the `agentSafety` dimension input; do not move or change it.\n- `packages/hench/src/tools/test-command-resolver.ts`, rex's `.rex/config.json` `test` field, and `packages/core/readme-generator.js` `detectCommands` each discover test commands differently. The profile's `commands` section is designed so they can later read one source of truth; unifying them is explicitly not this work.\n\nCarried over from the earlier readiness design and still binding: all CI providers are parsed up front rather than GitHub-only, so a supported provider never silently contributes missing data; a provider file that is present but unparseable is reported as a parse failure with its path, never as absence; readiness gaps stay out of the zone-findings stream, which is zone-scoped and LLM-enriched, because mixing them would corrupt zone health scores.\n\nHonest limits to preserve in the output: this tells you whether tests exist, run, and where the holes are — not whether they are good. Infra reading is configuration review, not a pentest or CVE scan. The scorecard is heuristic and must be labelled as such wherever it is published.\n\nOut of scope, to be captured separately as follow-ups: the dashboard view, turning gaps into rex proposals, changing hench gates, unifying the three test-command resolvers, and any remote API call (GitHub branch protection via API). Nothing in rex or hench changes in this work.\n\nOpen questions to settle during the work: whether the starting weights are right, and how precise each detector must be before its evidence is allowed to move a score."
lastModified: "2026-10-05T17:36:59.142Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Build the readiness scorecard with weights in one exported constant](./build-the-readiness-scorecard-with.md) | pending |
| [Build the sdlc-profile analyzer with its own bounded walk and CI parsing](./build-the-sdlc-profile-analyzer-with.md) | pending |
| [Declare the SdlcProfile schema and register sdlc-profile.json](./declare-the-sdlcprofile-schema-and.md) | in_progress |
| [Surface readiness through the sv CLI, ndx passthrough, MCP and the sv status](./surface-readiness-through-the-sv-cli.md) | pending |
