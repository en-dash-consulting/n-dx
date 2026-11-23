---
id: "605dd17e-9810-4c71-a1ca-638b98c1f4e8"
type: "task"
title: "PHP guard defaults for hench"
slug: "php-guard-defaults-for-hench"
summary: "Give the agent a PHP lint, the project's PHPUnit tests and a Composer file check as its default guards in PHP projects."
description: "In `packages/hench/src/schema/v1.ts` (`guardDefaultsForLanguage`) and wherever templates pick defaults (packages/hench/src/schema/templates.ts), add a `php` case, using lang-kit's php language id through hench's existing gateway rules (docs/architecture/gateways.md; no new cross-package import outside the gateway):\n\n- `php -l` on each changed `.php`/`.phtml`/`.inc` file;\n- `vendor/bin/phpunit` when `phpunit.xml` or `phpunit.xml.dist` exists and `vendor/bin/phpunit` exists, else no test guard (n-dx installs nothing, LS16);\n- `composer validate --no-check-publish` when `composer.json` exists and `composer` is on PATH.\n\nFollow how the Go defaults express commands, conditions and timeouts. Allowed-command lists hench keeps for the sandbox or guards must admit `php`, `composer` and `vendor/bin/phpunit` only for PHP projects.\n\nTests: PHP project with and without phpunit config and composer.json; TypeScript and Go defaults unchanged."
acceptanceCriteria:
  - "PHP projects get php -l, PHPUnit and composer validate guard defaults, each only when its prerequisite exists"
  - "TypeScript and Go guard defaults are unchanged"
  - "No new cross-package import outside hench's gateways"
priority: "medium"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "hench"
---
