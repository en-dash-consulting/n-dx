---
id: "901419bf-0993-4af5-bce0-40b681b42663"
type: "change"
title: "A root composer.json makes a JavaScript-primary checkout PHP for hench guards and repository trust"
slug: "a-root-composer-json-makes-a"
summary: "A project that is mostly JavaScript but carries a composer.json is now treated as PHP, so the agent loses its npm and node commands and the repository asks for trust again. Detection should weigh which language the project really is, as the analyser already does."
intent: "Severity: medium. Verdict: should-fix (found by ndx-adversarial-review of task 605dd17e \"PHP guard defaults for hench\").\n\nScenario: a checkout with package.json and a root composer.json, most of its source being JS/TS (a WordPress block plugin, a JS app with a small PHP backend). `detectRepoLanguage` (packages/llm-client/src/repo-trust.ts) and hench init's `detectProjectLanguage` (packages/hench/src/cli/commands/init.ts) both return \"php\" whenever a root composer.json exists, after go.mod and Swift markers only. Result: `hench init` writes the PHP guard (php, composer, phpunit, git), so the agent cannot run npm/node/tsc/vitest. A checkout initialized earlier with the JS guard now gets a `commands-added` trust finding and is clamped to the PHP baseline until `ndx trust accept .`. lang-kit's `detectLanguage` (packages/lang-kit/src/detect.ts) breaks multiple root markers with a source-file count instead, so sourcevision says TypeScript while hench says PHP.\n\nReachable: `hench init` / `ndx init` and every trust evaluation (ndx work, ndx trust) on such a checkout.\n\nOptions:\n1. Recommended: only pick php when composer.json is present and package.json is absent, or when PHP source outnumbers JS/TS (mirroring lang-kit's tiebreak). Cost: a small file count in detectRepoLanguage, which must stay cheap and marker-driven for trust; risk: the count is repository content, but it can only choose between two baselines that both block every dependency directory.\n2. Union the baselines for polyglot checkouts. Wider allowlist; weakens what trust compares against.\n3. Leave as is and rely on the changeset's Action needed note. Cheapest, but it makes the guard wrong for real repositories."
acceptanceCriteria:
  - "A checkout with package.json, a root composer.json and more JS/TS than PHP source is detected as typescript by detectRepoLanguage and by hench init"
  - "A checkout with composer.json and no package.json is still detected as php"
  - "A test covers the package.json + composer.json case in both packages/llm-client/tests/unit/repo-trust.test.ts and hench's init detection tests"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"605dd17e-9810-4c71-a1ca-638b98c1f4e8","run":"aed82431-5ce2-4325-8bfc-b003960acd6c"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "hench"
source: "ndx-adversarial-review"
---
