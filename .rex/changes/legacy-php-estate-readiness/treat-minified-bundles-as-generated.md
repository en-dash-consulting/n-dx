---
id: "0db6172b-4827-4226-98b5-60ca5841656c"
type: "task"
title: "Treat minified bundles as generated and keep them out of the call graph"
slug: "treat-minified-bundles-as-generated"
summary: "Stop committed minified JavaScript from bloating the analysis: a test repository's call graph grew to 260 MB from twenty bundles."
description: "**Operator note (2026-11-16, machine under heavy load):** run targeted tests only: single test files, or one package's affected tests for the files you change. No full suites, no `run-all-tests`, no fuzzing, no large generated repositories; small invented fixtures built in the test are fine. The six static root policy tests from the change's conventions are small and still required.\n\n**Problem.** Committed minified bundles are common in legacy web apps (jQuery, plugins, built front ends). On an invented 346 MB probe, 20 minified JavaScript files of 2.7 MB each (role `asset`, under `public/js/`) were still parsed by the call-graph phase: **1,400,000 \"functions\", and `callgraph.json` was 260 MB** of the 516 MB analysis output; the whole analysis peaked at 1.75 GB RSS. Elsewhere, `js/app.min.js` outside a public directory was inventoried with role `source`. Minified code is third-party or build output, never something to map.\n\n**Fix.**\n- Inventory classifies minified files as generated: `*.min.js`, `*.min.mjs`, `*.min.css`, `*-min.js`, `*.bundle.js` and source maps by name, plus a content check on the first bytes for a very long first line (for example any line over 2,000 characters in the first 64 KiB) on JS/CSS files that do not match by name. Use the existing generated-file mechanism (`generatedFilePatterns` / `generatedHeaders` in lang-kit configs, `analyzers/inventory.ts`).\n- The call-graph phase, and any other per-function or per-symbol phase that would parse it (components, JS/TS imports if they parse bodies), skips files whose role is `generated` or `asset`. Check what `classifications`/zones do with them and keep them out of call-graph statistics.\n- A repository with no minified files keeps byte-identical output.\n\n**Default and opt-in (requirement from a real scan, shape only):** committed minified bundles *outside* `vendor/` (for example a theme's `js/` folder, not under `public/`) produced 53–69 MB of `callgraph.json` per repository, while PHP was absent from it. So:\n- minified files, wherever they sit, are kept out of `callgraph.json` by default (role `generated`, or a dedicated third-party marking if the inventory already has one);\n- a flag brings them back for whoever wants them: `sv analyze --include-minified` (forwarded unchanged by `ndx analyze`, listed in both help texts);\n- the analyze log prints one line with how many minified files were left out of the call graph, and the flag that includes them.\n\n**Docs:** say plainly that `callgraph.json` covers JavaScript and TypeScript only for now, and that PHP call facts are not yet in it: in `packages/lang-php/AGENTS.md` (the `produces` line names `calls`, so qualify it), `packages/lang-php/README.md`, and the sourcevision artifact docs that describe `callgraph.json` (`docs/packages/sourcevision*.md`, the package README).\n\n**Tests:** an invented fixture with a generated minified bundle (built in the test, a few hundred KB is enough), a `.min.js` outside `public/`, a long-line bundle without `.min` in its name, and a normal source file; assert roles, that the call graph holds only the source file's functions, and that inventory still lists the minified files."
acceptanceCriteria:
  - "Minified files by name or by long-line content get role generated"
  - "The call graph and other per-function phases skip generated and asset files"
  - "Repositories without minified files keep byte-identical output"
  - "Minified files outside vendor and public folders stay out of callgraph.json by default and --include-minified brings them back"
  - "The docs say callgraph.json covers JavaScript and TypeScript only"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "sourcevision"
  - "lang-kit"
  - "performance"
  - "estate-readiness"
  - "php-pr12"
blockedBy:
  - "f9173794-5641-4098-b703-826467da5886"
---
