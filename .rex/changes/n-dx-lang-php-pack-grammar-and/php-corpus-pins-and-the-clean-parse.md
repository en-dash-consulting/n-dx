---
id: "220d4f19-4cf3-488b-baae-bd894498844b"
type: "task"
title: "PHP corpus pins and the clean-parse report"
slug: "php-corpus-pins-and-the-clean-parse"
summary: "Pin a set of public PHP applications, from old PHP 5 code to modern frameworks, and add a report that measures how cleanly the PHP pack parses each one."
description: "Add `packages/sourcevision/scripts/php-corpus.json`, `php-corpus-clone.mjs`, `php-corpus.mjs` and `php-corpus-report.mjs`, mirroring the Python ones (python-corpus*.mjs). The corpus lives in `~/.cache/ndx-php-corpus`; neither script runs in the test suite.\n\n- `php-corpus.json` lists repositories with url, pinned commit SHA and a `shape` note. Use the entries and SHAs from the operator note below exactly.\n- The report prints, per repository: PHP file count, files parsed with no ERROR or MISSING node, the clean-parse rate, the ten most frequent error node parents with one example location each, and parse time. It ends with an overall line and a separate line for the PHP 5 repositories.\n- Decision D4 bar: at least 99.5% clean parse on the PHP 5 repositories.\n\n**Operator note:** the agent cannot clone or read `~/.cache`. The operator fills in the corpus list (url + SHA) here before the run, clones it with the script after the run, runs the report, and records the numbers with append_log on this task."
acceptanceCriteria:
  - "php-corpus.json pins every corpus repository by commit SHA"
  - "The clone and report scripts mirror the Python corpus scripts and report the clean-parse rate per repository and for the PHP 5 repositories together"
  - "The operator's measured rates are logged on the task"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"standard","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-php"
  - "corpus"
blockedBy:
  - "5cd796e9-6177-4d40-8439-b1678e700322"
---
