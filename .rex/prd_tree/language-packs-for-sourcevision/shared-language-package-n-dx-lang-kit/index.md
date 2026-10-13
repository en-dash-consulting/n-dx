---
id: "62f9bb19-c606-422d-b643-a4877b6dfcfd"
level: "feature"
title: "Shared language package (@n-dx/lang-kit)"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "lang-kit"
  - "sourcevision"
  - "side-stack"
  - "pr-11"
source: "roadmap"
acceptanceCriteria:
  - "`pnpm build` builds packages/lang-kit before packages/sourcevision, and `cd packages/lang-kit && npx vitest run` passes"
  - "`grep -rE \"from \\\"@n-dx/\" packages/lang-kit/src` finds nothing, and packages/lang-kit/package.json has no `dependencies` key"
  - "`cd packages/sourcevision && SV_REQUIRE_GRAMMARS=1 npx vitest run` passes with every language-pack golden and analysis fixture unchanged"
  - "The Java corpus report gives 99.93% clean parse and the Go corpus report on gitea gives 98.69% clean with import parity 3130 of 3131, as on PR 10"
  - "The root policy suites listed in the description pass"
description: "Decided with Sterling H on 2026-10-12 (all nine decisions): sourcevision becomes a language-neutral engine, and languages and frameworks arrive as packs on top of a new foundation-tier package, @n-dx/lang-kit. This feature creates the package with no dependencies beyond Node, moves sourcevision's pure language facts into it, defines the facts-out pack contract there, and makes sourcevision use it. Analysis output must stay byte-identical.\n\nThis supersedes the epic's earlier rule \"no new package, the pack interface stays inside sourcevision\": the new package is @n-dx/lang-kit, and the architecture policy tests change to admit it as foundation tier. The epic's other rules still apply.\n\nOut of scope (later PRs): the parser runtime package, per-language pack packages, `ndx sv pack add` and opt-in installs (PR 12). Resolvers (java-resolver.ts, go-resolver.ts), runner.ts, pack.ts's loader, the *-pack.ts files, queries, grammars and the SQL modules stay in sourcevision. The Terraform model (PR 13). rex, hench, core and web adoption of lang-kit, including 9b692c8a (one go.mod parser), happens later off main: do not touch rex, hench, core or web source. No language SDK or toolchain may be required at run time (LS16).\n\nThe bar for every task: analysis output byte-identical (every language-pack golden and analysis fixture), and the Java and Go corpus reports give PR 10's numbers (Java 99.93% clean parse; Go on gitea 98.69% clean, import parity 3130 of 3131).\n\nGates after every task (rebuild first with `pnpm build`):\n- `cd packages/lang-kit && npx vitest run`\n- `cd packages/sourcevision && SV_REQUIRE_GRAMMARS=1 npx vitest run`\n- `npx vitest run --config vitest.config.js tests/e2e/{architecture-policy,domain-isolation,instruction-alignment,layout-literal-policy,agents-md-size-budget,prd-line-endings,ci-merge-queue-trigger,iso-skill-drift}.test.js`\n- The epic's static policy tests: shell-spawn-inventory-policy, wall-clock-inventory-policy, obfuscated-code-policy.\n\nSide stack, PR 11, branched from PR 10's tip. Session doc: https://claude.ai/artifact/Cnn6si8Bnqzm3ujQ2uf5Pp"
lastModified: "2026-10-13T02:34:45.397Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Create the @n-dx/lang-kit package and wire it into the workspace, release and architecture policy](./create-the-n-dx-lang-kit-package-and.md) | completed |
| [Define the facts-out pack contract in lang-kit and adapt the Java, Go and SQL packs through a sourcevision adapter](./define-the-facts-out-pack-contract-in.md) | pending |
| [Move language ids, configs, detection, build-file readers and the small TOML/XML/YAML parsers into lang-kit](./move-language-ids-configs-detection.md) | completed |
| [Move the IaC resource-kind table into lang-kit as data](./move-the-iac-resource-kind-table-into.md) | pending |
| [web and graview vitest load sourcevision source but resolve @n-dx/lang-kit to its built dist](./web-and-graview-vitest-load.md) | completed |
