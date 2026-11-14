---
id: "a6e82740-8767-4eba-86f9-e53327fdfc9a"
type: "change"
title: "PHP compatibility facts"
slug: "php-compatibility-facts"
summary: "Flag the PHP features each file uses that newer PHP versions removed or deprecated, and the oldest PHP version each file needs. This tells a migration how much porting each legacy repository needs to run on the target's PHP."
intent: "PR 8 of the PHP language-pack stack, stacked on PR 7. The pack reports, per file, the newest syntax it uses (an observed-syntax version floor) and the removed or deprecated constructs it uses, each rule citing the php.net migration guide page it comes from. Per-repository counts land in readiness, which already carries ecosystem facts.\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- LS3/LS4: every version boundary in a rule cites its php.net migration guide URL in the rule's provenance; no end-of-life dates anywhere.\n- Analyze output stays byte-identical for every repository without PHP files, and for PHP repositories without the pack.\n- Do not change sourcevision MCP tool names, required parameters or response shapes; only optional fields.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "Each PHP file gets an observed-syntax version floor from the constructs it uses"
  - "Removed and deprecated constructs are reported per file with rule provenance, and per-repository counts appear in readiness"
  - "Counts on two corpus apps match a manual count logged on the task"
amends: [{"target":"c25bbf92-9b20-4b29-8b54-da85da464b75","delta":"added","summary":"PHP compatibility facts","criteria":{"add":[{"id":"php-version-floor","text":"Each PHP file has a version floor from the syntax it uses"},{"id":"php-removed-constructs","text":"Removed and deprecated constructs are counted per file and per repository with provenance"}]},"proposed":"Sourcevision reports each PHP file's observed-syntax version floor and its removed or deprecated constructs, each rule citing the php.net migration guides, with per-repository counts in readiness.","under":"58f0468b-33ce-46ee-b507-c95261f152b6","title":"PHP compatibility facts","type":"capability"}]
priority: "medium"
tags:
  - "php"
  - "lang-php"
  - "php-pr8"
blockedBy:
  - "b74c12c2-673c-488b-9559-9f999d9440b4"
---
