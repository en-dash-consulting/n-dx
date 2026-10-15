---
id: "6119e976-db18-4bb7-a1e1-ae6e40b7d197"
level: "feature"
title: "Install language packs: ndx sv pack add, offline bundles and the project pack list (12b)"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "lang-runtime"
  - "sourcevision"
  - "side-stack"
  - "pr-12b"
blockedBy:
  - "2bc7ded9-e12e-4297-bdca-42355e4c7645"
source: "roadmap"
acceptanceCriteria:
  - "`sv pack add java` installs @n-dx/lang-java at sourcevision's version into the pack dir, `sv pack list` shows it, `sv pack remove java` removes it (tests with an injected npm runner and a temp ndx home)"
  - "`sv pack bundle java --out f.tgz` then `sv pack add java --from f.tgz` installs with no network, and a bundle of the wrong pack or version is refused"
  - "With `sourcevision.packs: [\"java\"]` in the project config and no Java pack, analyze prints one notice naming `ndx sv pack add java`; `sv pack add` with no language installs the listed packs"
  - "The missing-pack notice names `ndx sv pack add <lang>` instead of the npm command"
  - "Analysis output is byte-identical with no project pack list"
  - "The root policy suites pass"
description: "Decision 7 (LS9), second half: new languages are opt-in, \"installed with a sourcevision command or from an offline tarball, and the project's .n-dx.json can list the packs it wants\". 12a built the per-user pack directory (`<resolveNdxHome()>/packs/<sourcevision version>/`, `defaultPackDir()` and `packInstallCommand()` in packages/sourcevision/src/language/pack-loader.ts) and the loader that reads it; 12b gives users the commands. Brief: workshop analysis/language-scaling/pr12-runtime-and-packs-brief.md, section 12b.\n\nKnown packs: java, go, sql, terraform (`@n-dx/lang-<id>`, version always equal to sourcevision's). Analysis loads only Java and Go today (KNOWN_PACKS in pack-loader.ts); `pack add` accepts all four.\n\nRules for every task:\n- No core change: `ndx sv <args>` already passes through to sourcevision's CLI (packages/sourcevision/src/cli/index.ts).\n- Every new child process (npm, tar) goes through @n-dx/llm-client's spawn helpers and is registered where tests/e2e/shell-spawn-inventory-policy.test.js expects; tests inject the runner and never touch the network or the user's real ndx home.\n- No dependency added to any package.json (agents cannot run `pnpm install`); if one seems needed, stop and say so.\n- Analysis output stays byte-identical when no project pack list is set (the default).\n- Do not touch rex, hench, core or web source.\n\nGates after every task (rebuild first): sourcevision and every lang-* suite; the root policy suites (architecture-policy, domain-isolation, instruction-alignment, layout-literal-policy, agents-md-size-budget, vitest-hidden-spawn-policy, prd-line-endings, ci-merge-queue-trigger, iso-skill-drift, shell-spawn-inventory-policy, wall-clock-inventory-policy, obfuscated-code-policy). The root AGENTS.md chain has about 119 bytes of headroom (agents-md-size-budget): document the commands in packages/sourcevision/AGENTS.md and docs, not in the root guidance.\n\nSide stack, PR 12b, cut from 12a's tip 3e5e37544."
lastModified: "2026-10-15T04:26:06.266Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add `sv pack add`, `pack list` and `pack remove` over the per-user pack directory](./add-sv-pack-add-pack-list-and-pack.md) | completed |
| [Install packs offline: `sv pack bundle` and `sv pack add --from <bundle>`](./install-packs-offline-sv-pack-bundle.md) | completed |
| [pack add --from keeps the working install until the new bundle loads, and refuses a null manifest cleanly](./pack-add-from-keeps-the-working.md) | completed |
| [Read the project's pack list from .n-dx.json and isolate NDX_HOME in tests that run sourcevision](./read-the-project-s-pack-list-from-n-dx.md) | completed |
| [`sv pack` CLI dispatch has no test: a broken `pack` case in cli/index.ts would pass every suite](./sv-pack-cli-dispatch-has-no-test-a.md) | pending |
