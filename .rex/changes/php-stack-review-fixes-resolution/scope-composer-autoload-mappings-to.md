---
id: "08c6f81a-f090-4a59-8966-08d65bf3a58b"
type: "task"
title: "Scope Composer autoload mappings to the project that owns the referring file"
slug: "scope-composer-autoload-mappings-to"
summary: "Stop one app's classes resolving to another app's files when a repository holds several Composer projects that use the same namespace."
description: "Closes Codex thread 4592672439 on #1053 (`packages/lang-php/src/php-resolver.ts`, around line 405 at 72b36ae7b).\n\n**Problem.** Every Composer project's autoload mappings are combined into one index (`interface Mapping { prefix; paths }` has no owner), and lookup takes the first target that exists. Reproduction:\n- `a/composer.json` and `b/composer.json` both map `App\\` to `src/`;\n- each app declares `App\\Foo` in its own `src/Foo.php`;\n- `new \\App\\Foo()` in `b/main.php` resolves to `a/src/Foo.php`.\nThis creates false links between the apps.\n\n**Fix.**\n- Keep the owning Composer project (its manifest directory) on every PSR-4, PSR-0 and classmap mapping, and on composer.lock prefixes.\n- When resolving a reference, consider only the mappings of the project that owns the referring file: the nearest enclosing `composer.json`. Also consider the mappings of `path` repositories that project requires.\n- A file outside every Composer project keeps today's behaviour: all mappings, longest prefix first.\n- Classmap and the declared-type fallback get the same scoping.\n\n**Tests:**\n- the two-app reproduction above;\n- a path-repository dependency still resolving across projects;\n- a single-project repository unchanged (goldens identical)."
acceptanceCriteria:
  - "In a repository with two Composer projects mapping the same namespace, each app's references resolve to its own files"
  - "References into a required path repository still resolve across projects"
  - "Single-project and project-less resolution results are unchanged"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "resolver"
---
