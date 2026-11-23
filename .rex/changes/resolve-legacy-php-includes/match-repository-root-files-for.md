---
id: "3679880e-8370-4938-9834-2fe6c87b8265"
type: "task"
title: "Match repository-root files for dynamic PHP includes whose literal suffix starts with a slash"
slug: "match-repository-root-files-for"
summary: "Includes like DRUPAL_ROOT . '/includes/bootstrap.inc' should list includes/bootstrap.inc as a candidate file. Today the leading slash stops any file at the top of the repository from matching, so Drupal-style code gets no candidates at all."
description: "Found by the operator's corpus hand-check after task fd220c20 (resolve report, drupal7).\n\nFailure: `include_once DRUPAL_ROOT . '/includes/bootstrap.inc';` with `define('DRUPAL_ROOT', getcwd());`. The prefix is not computable, so `candidates()` in packages/lang-php/src/php-includes.ts searches the whole repository for files ending in the suffix `/includes/bootstrap.inc`. The repository file is `includes/bootstrap.inc` (no leading slash), so `f.endsWith(suffix)` fails and the include gets no candidates. Most of drupal7's 172 dynamic-without includes are this shape.\n\nFix: when there is no computable prefix and the suffix starts with `/`, a file matches when `'/' + f` ends with the suffix (so both `includes/bootstrap.inc` and `sites/x/includes/bootstrap.inc` match). Keep the rule that a suffix without any `/` constrains nothing. Candidates stay notices, never edges (D3).\n\nAdd a fixture line to the dynamic-include integration test: a root-level `includes/bootstrap.inc` and `include_once SOME_RUNTIME_ROOT . '/includes/bootstrap.inc';` with the constant defined from a function call; expect exactly that candidate."
acceptanceCriteria:
  - "A dynamic include with no computable prefix and a suffix starting with / lists matching files at the repository root as candidates"
  - "Candidates still never become edges, and the existing candidate tests pass unchanged"
  - "Non-PHP output is byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "62d00b31-5486-4414-ab7d-8beb84c5cb2f"
---
