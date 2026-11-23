---
id: "938d1611-a5d7-4fd9-81e5-422e2b47a776"
type: "task"
title: "Make function-shadowing suppression namespace-aware in the legacy and dynamic-code scanners"
slug: "make-function-shadowing-suppression"
summary: "Stop a helper function in one namespace from hiding real uses of a built-in PHP function with the same name elsewhere, which today silently drops removed-feature and dynamic-code findings."
description: "Closes two Codex threads:\n- 4592673014 on #1075 (`packages/lang-php/src/php-legacy.ts`, around line 325);\n- 4592673548 on #1081 (`packages/lang-php/src/php-dynamic-code.ts`, `declaredFunctions()` and its use in `codeSites`).\n\n**Problem.** Both scanners collect the functions the repository declares as lower-cased short names across all files, and suppress any call to a built-in with that name. So `namespace Helpers; function mysql_query($s) {}` in one file hides an explicit `\\mysql_query(...)` in another, and the PHP 7 removal finding is lost. Likewise `namespace Helpers; function call_user_func($f) {}` hides `\\call_user_func($handler)` and any database provenance it has.\n\n**Fix.** Write one shared helper used by both scanners, instead of two copies:\n- Index declared functions by fully qualified name (namespace plus name).\n- Resolve each unqualified call the way PHP does:\n  - the current namespace's function first, after `use function` aliases;\n  - then the global function.\n- A fully qualified call (`\\name`) resolves to the global function only.\n- Suppress a finding only when the call resolves to a repository-declared function.\n- A repository that declares a global function with a built-in's name (legacy polyfills of `mysql_query`, for example) keeps suppression for unqualified calls in the global namespace.\n\n**Tests, for each scanner:**\n- the two reproductions above;\n- a namespaced helper called unqualified from inside its own namespace, which stays suppressed;\n- a global polyfill, which stays suppressed;\n- a `use function` alias."
acceptanceCriteria:
  - "A namespaced helper no longer suppresses explicit global calls or unqualified calls from other namespaces, in both the legacy-construct and dynamic-code scanners"
  - "Calls that resolve to a repository-declared function, including a global polyfill, stay suppressed"
  - "Both scanners share one namespace-aware resolution helper"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
blockedBy:
  - "08c6f81a-f090-4a59-8966-08d65bf3a58b"
---
