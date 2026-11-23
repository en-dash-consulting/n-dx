---
id: "fd04acac-099e-4ea0-8364-84298a85678a"
type: "change"
title: "@n-dx/lang-php pack: grammar and structure facts"
slug: "n-dx-lang-php-pack-grammar-and"
summary: "Add an opt-in PHP language pack that parses PHP files, including old PHP 5 code mixed with HTML, and reports their includes, namespaces, classes, functions and calls. It also measures how cleanly the parser reads a set of real legacy PHP apps."
intent: "PR 2 of the PHP language-pack stack, stacked on PR 1. Adds the `@n-dx/lang-php` package, laid out like `@n-dx/lang-python`, with the pinned tree-sitter-php grammar built to WASM, structure queries, goldens and a pinned PHP corpus with a clean-parse report (decision D4: the mixed-HTML `php` grammar, not `php_only`). Facts reach the engine through the pack contract; nothing is resolved into edges yet (PR 3, PR 4).\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- D1: open-core, opt-in `@n-dx/lang-php` (`ndx sv pack add php`).\n- D3: symbol kinds `trait`, `namespace`, `constant`; ImportGuard `conditional`; dynamic includes with a literal prefix carry candidate files that never become import edges.\n- D4: pass bar is at least 99.5% of corpus PHP files parsed with no ERROR or MISSING nodes; the operator stops the lane only below 95%.\n- Analyze output stays byte-identical for every repository without PHP files, and for PHP repositories without the pack.\n- LS16: no PHP toolchain is used. LS3/LS4: no PHP versions from memory.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps; task descriptions name them.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names; the new package joins the changeset `fixed` group at the current fixed version.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js.\n\nRelease note: `@n-dx/lang-php` is a new npm name. It needs a first publish by an org member and a trusted publisher on release.yml before a release can publish it."
acceptanceCriteria:
  - "With the pack installed, PHP files yield import, symbol and call facts that match committed goldens"
  - "Without the pack, analyze output is unchanged for PHP repositories and byte-identical for all others"
  - "A corpus report gives the clean-parse rate per corpus repository"
amends: [{"target":"3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11","delta":"added","summary":"@n-dx/lang-php pack: grammar and structure facts","criteria":{"add":[{"id":"php-structure","text":"PHP files yield import, symbol and call facts that match committed goldens"},{"id":"php-clean-parse","text":"The corpus clean-parse rate is reported per repository"}]},"proposed":"The opt-in @n-dx/lang-php pack parses PHP, including PHP 5 code mixed with HTML, with a pinned tree-sitter-php grammar and reports each file's includes, namespaces, use imports, declarations and calls, measured against a pinned PHP corpus.","under":"58f0468b-33ce-46ee-b507-c95261f152b6","title":"PHP structure through tree-sitter","type":"capability"}]
priority: "high"
tags:
  - "php"
  - "lang-php"
  - "php-pr2"
blockedBy:
  - "4335fd54-3711-4677-a070-e14fefefa998"
---
