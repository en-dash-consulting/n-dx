---
id: "6122f413-b6ff-43d6-9aee-07ea9b4504e4"
type: "change"
title: "Hench guards for PHP"
slug: "hench-guards-for-php"
summary: "Give the autonomous agent PHP-specific safety checks, such as a syntax lint, the project's PHPUnit suite and a composer.json check, so an agent's PHP change can't be marked done while broken."
intent: "PR 9 of the PHP language-pack stack, stacked on PR 8. `guardDefaultsForLanguage` (packages/hench/src/schema/v1.ts, used by packages/hench/src/schema/templates.ts) has defaults for TypeScript and Go only. Add PHP defaults so hench runs in PHP projects lint and test the agent's changes.\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- LS16: guards run the project's own tools when present; n-dx installs nothing.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`.\n- Patch changesets with scoped package names.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "A PHP project gets PHP guard defaults: php -l on changed PHP files, PHPUnit when a phpunit config exists, and composer validate when composer.json exists"
  - "Projects in other languages get unchanged guard defaults"
amends: [{"target":"4edba59e-0cee-495d-960c-7b2c42fe7939","delta":"added","summary":"Hench guards for PHP","criteria":{"add":[{"id":"php-guards","text":"PHP projects get php -l, PHPUnit and composer validate guards, each only when its prerequisite exists"}]},"proposed":"Hench runs in PHP projects lint changed PHP files and run the project's own PHPUnit and Composer checks when they exist.","under":"4fc05c48-48b0-4da3-8126-4fa237b924d9","title":"PHP guard defaults","type":"capability"}]
priority: "medium"
tags:
  - "php"
  - "hench"
  - "php-pr9"
blockedBy:
  - "a6e82740-8767-4eba-86f9-e53327fdfc9a"
---
