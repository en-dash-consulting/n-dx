---
id: "91476ef4-b036-4e03-87c3-d8d46f734727"
type: "task"
title: "Detect PHP when the app sits one folder below the repository root"
slug: "detect-php-when-the-app-sits-one"
summary: "PHP repositories that keep their code in a subfolder are detected as TypeScript today, so the PHP pack never runs on them. Legacy estates often lay code out this way."
description: "PR 6's corpus check found that phpBB and osCommerce 2 are detected as TypeScript. phpBB keeps its code in `phpBB/`, with its composer.json there. osCommerce 2 keeps its code in `catalog/`. `hasWeakPhpMarker` and the composer marker in packages/lang-kit/src/detect.ts look only at the repository root and the docroot directories, and never walk deeper, so detection falls back to TypeScript.\n\nThe fix, in detect.ts and php.ts:\n1. A composer.json in a direct child directory counts as the PHP manifest marker, but only when the root has no marker of another language.\n2. An index.php in any direct child directory counts as the weak PHP marker, under the same condition.\n3. When no marker of any language is found at the root or one level down, pick the language with the most source files from the existing per-language counts, PHP included.\n\nNever walk deeper than one level. A TypeScript repository with package.json and a `php/` or `legacy/` subfolder holding index.php keeps its current detection. Update the step list in detect.ts's doc comment.\n\nTests:\n- a phpBB-shaped fixture: `phpBB/composer.json` and `phpBB/index.php`, with only README, `build/` and `tests/` at the root;\n- an osCommerce-shaped fixture: `catalog/index.php` and `docs/`;\n- a TypeScript repository with a php subfolder, which stays TypeScript;\n- a markerless repository with 300 .php and 50 .js files, which is detected as PHP;\n- every existing detection fixture unchanged.\n\nOperator note: touch only packages/lang-kit and packages/lang-php (src, tests, fixtures, AGENTS.md if the detection rules it lists change) plus patch changesets with scoped names. Agents cannot read ~/.cache; the operator analyzes the phpbb and oscommerce2 corpus apps after the run. Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "A repository whose PHP app sits one folder below the root (composer.json or index.php in a direct child) is detected as PHP."
  - "A markerless repository is detected as the language with the most source files."
  - "Repositories with another language's marker at the root keep their current detection, and existing detection fixtures are unchanged."
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "php"
  - "lang-kit"
source: "operator-corpus-check"
---
