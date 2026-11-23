---
id: "f0d1bbab-2a17-4645-af58-aa002a7efb5b"
type: "task"
title: "Keep in-repository Composer packages a project requires by name in its resolution scope"
slug: "keep-in-repository-composer-packages-a"
summary: "A bundled library that another bundled library depends on stopped linking after the per-app scoping fix; restore those links without bringing back links between unrelated apps."
description: "Follow-up to task 08c6f81a (run 03257867, commits 3ead92375 and 15bcc5bd4), found by the operator corpus check on 2026-11-16.\n\n**Problem.** Since 3ead92375, a Composer project's scope holds only its own mappings, the projects that enclose it and the `path` repositories it requires. A package it requires by name that is vendored in the repository as its own Composer project drops out of scope. Drupal 7 in the corpus:\n- `misc/typo3/phar-stream-wrapper/composer.json` has `\"require\": {\"brumann/polyfill-unserialize\": \"^1.0\"}` and no `repositories` entry;\n- `misc/brumann/polyfill-unserialize/composer.json` is named `brumann/polyfill-unserialize` and maps `Brumann\\\\Polyfill\\\\` to `src/`;\n- `use Brumann\\Polyfill\\Unserialize;` in `misc/typo3/phar-stream-wrapper/src/Phar/Manifest.php` resolved via PSR-4 to `misc/brumann/polyfill-unserialize/src/Unserialize.php` before, and is now `internal-not-found`. Drupal 7's internal rate fell from 644/644 to 642/644.\n\nComposer would load that package's autoload for the requiring project, so the edge is real.\n\n**Fix** in `packages/lang-php/src/php-resolver.ts`:\n- A project's scope also includes every in-repository Composer project whose `name` appears in the requiring project's `require` or `require-dev` (case-insensitive, as Composer compares package names), whether or not a `path` repository declares it.\n- Follow these requirements transitively, with a visited set, as Composer installs transitive dependencies.\n- Two apps that share a namespace but do not require each other stay apart: the two-app reproduction from task 08c6f81a must still pass.\n\n**Tests:**\n- add a fixture of the Drupal shape: two sibling projects, one requiring the other by name with no `repositories` entry, and a `use` in the requiring one that resolves to the other's PSR-4 file;\n- a transitive case (A requires B by name, B requires C by name; A's reference into C resolves);\n- the existing php-composer-apps tests unchanged.\n\nThe operator re-runs `php-resolve-report.mjs` afterwards. Agents cannot read `~/.cache`."
acceptanceCriteria:
  - "A project's references into an in-repository Composer package it requires by name resolve to that package's files, transitively"
  - "Two Composer apps mapping the same namespace without requiring each other still resolve to their own files"
  - "The task 08c6f81a tests pass unchanged"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "08c6f81a-f090-4a59-8966-08d65bf3a58b"
---
