---
id: "2bc7ded9-e12e-4297-bdca-42355e4c7645"
level: "feature"
title: "Parser runtime and language packs (12a)"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "lang-runtime"
  - "sourcevision"
  - "side-stack"
  - "pr-12a"
blockedBy:
  - "62f9bb19-c606-422d-b643-a4877b6dfcfd"
source: "roadmap"
acceptanceCriteria:
  - "`git grep -nE \"web-tree-sitter|@n-dx/lang-runtime\" packages/sourcevision/src` finds only the pack loader's dynamic import, and packages/sourcevision/package.json lists neither web-tree-sitter nor build/grammars nor src/language/queries"
  - "Each of packages/lang-{java,go,sql,terraform} ships its queries and build/grammars/*.wasm (`npm pack --dry-run` lists them) and passes `npx vitest run`"
  - "With the workspace's packs, sv analyze output and the Java, Go and SQL corpus reports equal PR 11's"
  - "Without @n-dx/lang-java, a Java project gets inventory and one notice naming the install command; without @n-dx/lang-go, Go edges come from the regex parser"
  - "A pack whose version differs from sourcevision's is refused with a notice naming the command that fixes it"
  - "The root policy suites pass"
description: "Design-session decisions 6 and 7 (LS9) and step 4 of the agreed order: the tree-sitter parser runtime becomes its own package that only packs load, and Java, Go, SQL and Terraform become packs that sourcevision loads at run time. Go installs by default as an optional dependency of @n-dx/sourcevision; Java, SQL and Terraform are opt-in. Brief: workshop analysis/language-scaling/pr12-runtime-and-packs-brief.md.\n\nDecided by Ryan 2026-10-13: opt-in packs install into a per-user pack directory, `<resolveNdxHome()>/packs/<sourcevision version>/` (`npm install --prefix`); SQL and HCL become packs here too, so sourcevision ends this feature with no web-tree-sitter, grammar or query; the install command, offline tarballs and the .n-dx.json pack list are the next feature (12b).\n\nThe packages exist already (operator scaffolding commit on this branch): @n-dx/lang-runtime, @n-dx/lang-java, @n-dx/lang-go, @n-dx/lang-sql, @n-dx/lang-terraform, each with package.json, tsconfig, vitest config, AGENTS.md + CLAUDE.md, a placeholder export; workspace, lockfile, changeset, `fixed` group, release PACKAGES lists and the pack-tier boundary test are wired. sourcevision has @n-dx/lang-go as an optional dependency and the other four as devDependencies, and the vitest configs of sourcevision, web and graview alias every @n-dx/lang-* package to its src/index.ts. Agents cannot run `pnpm install`: never add, remove or rename a dependency; if a task needs one, stop and say so.\n\nRules for every task:\n- Moves use `git mv` so history follows; behaviour, comments and notice wording move unchanged unless the task says otherwise.\n- No pack imports another pack. No tree-sitter type enters @n-dx/lang-kit.\n- Corpus and comparison scripts stay in packages/sourcevision/scripts and import the packs from the workspace (a pack never depends on sourcevision).\n- Do not touch rex, hench, core or web source. No language SDK or toolchain at run time (LS16).\n\nThe bar: with the Java and Go packs present (the workspace), analysis output stays byte-identical to PR 11 and the Java, Go and SQL corpus reports give PR 11's numbers (Java 99.93% clean; Go on gitea 98.69% clean, import parity 3130/3131, edge parity pack 13077 edges / 11537 external pairs). Gates after every task (rebuild first): each lang-* package's `npx vitest run`; `cd packages/sourcevision && SV_REQUIRE_GRAMMARS=1 npx vitest run` (the operator runs this one: agents cannot set the variable); the root policy suites (architecture-policy, domain-isolation, instruction-alignment, layout-literal-policy, agents-md-size-budget, prd-line-endings, ci-merge-queue-trigger, iso-skill-drift, shell-spawn-inventory-policy, wall-clock-inventory-policy, obfuscated-code-policy).\n\nSide stack, PR 12a, cut from PR 11's tip 132bde32d."
lastModified: "2026-10-13T16:48:47.611Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A pack whose analyzeProject rejects fails the whole imports phase instead of degrading its language](./a-pack-whose-analyzeproject-rejects.md) | pending |
| [Define the pack entry in lang-kit, move Java and Go into their packs, and load packs at run time](./define-the-pack-entry-in-lang-kit-move.md) | completed |
| [Drop the parser runtime from sourcevision and enforce dynamic-only pack loading](./drop-the-parser-runtime-from.md) | pending |
| [Move SQL and Terraform (HCL) into @n-dx/lang-sql and @n-dx/lang-terraform](./move-sql-and-terraform-hcl-into-n-dx.md) | completed |
| [Move the tree-sitter runtime into @n-dx/lang-runtime](./move-the-tree-sitter-runtime-into-n-dx.md) | completed |
| [Workspace tests and corpus scripts load opt-in packs from the user's real pack directory, shadowing workspace code](./workspace-tests-and-corpus-scripts.md) | in_progress |
