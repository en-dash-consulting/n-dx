---
id: "f0979b38-b04d-418e-9509-ddf5f7400203"
type: "task"
title: "Replace the eleven polynomial-time regexes CodeQL flagged in the PHP pack"
slug: "replace-the-eleven-polynomial-time"
summary: "Rewrite the text patterns GitHub's security scanner flagged so that analysing an unusual or very long line can't stall, with no change to what they match."
description: "Closes CodeQL alerts #124–#134, all `js/polynomial-redos` (high). The input is the content of the repositories being analysed, which on an engagement is third-party code, so a pathological line must not stall analyze.\n\nThe alerts, with locations at stack tip 72b36ae7b (search for the pattern; line numbers drift):\n\n| Alert | File | Pattern |\n|---|---|---|\n| #125 | `packages/lang-kit/src/php-composer.ts`, `normalize` | `.replace(/\\/+$/, \"\")` |\n| #126 | `packages/lang-php/src/php-resolver.ts`, `excludePattern` | `.replace(/\\/+$/, \"\")` |\n| #130 | `packages/lang-php/src/php-includes.ts`, `dirname` | `path.replace(/\\/+$/, \"\")` |\n| #131 | `php-includes.ts`, `.htaccess` include_path | `/^\\s*php_value\\s+include_path\\s+(.+?)\\s*$/i` |\n| #132 | `php-includes.ts`, `php.ini` include_path | `/^\\s*include_path\\s*=\\s*(.*)$/` |\n| #133 | `php-includes.ts`, same function | `/^([\"'])(.*?)\\1/` and `raw.replace(/\\s*;.*$/, \"\")` |\n| #129 | `packages/lang-php/src/php-entry-points.ts` | `COMPARISON = /^([\\s\\S]*?)\\s*(?:===\\|!==\\|==\\|!=\\|<>)\\s*([\\s\\S]*)$/` |\n| #127, #128 | `packages/lang-php/src/php-htaccess.ts`, `words` | `/\"((?:[^\"\\\\]\\|\\\\.)*)\"\\|(\\S+)/g` |\n| #134 | `packages/lang-php/src/php-outbound.ts`, `keyValues` | `/([A-Za-z_][\\w ]*?)\\s*=\\s*('[^']*'\\|\"[^\"]*\"\\|[^;\\s]*)/g` |\n| #124 | `packages/lang-kit/src/pack-contract.ts`, `normalizeFlagName` | `.replace(/^_+\\|_+$/g, \"\")` and the leading-`_` trim |\n\n**Fix.** Replace each pattern with code that runs in linear time and gives the same results on the existing tests:\n- trailing and leading character trims become small index loops, in one shared helper per package;\n- the comparison split scans for the operator with `indexOf`;\n- `words()` becomes a hand-written tokenizer: quoted words with `\\\"` escapes, otherwise runs of non-space, with an unterminated quote taking the rest of the line;\n- the include_path and DSN parsers split on the first `=` and on `;` explicitly, and trim with loops.\n\nWhere a regex stays, it must have no overlapping quantifiers. Also cap the length of any single line these parsers read at 64 KiB: longer lines are skipped and counted in a notice.\n\n**Tests:** for each replaced pattern:\n- the existing behaviour tests pass unchanged;\n- a new test feeds CodeQL's pathological input (for example 100,000 `/` with a trailing non-slash, 100,000 spaces after `php_value include_path `, a long `\"\\\"!` run, 100,000 `_`) and asserts it finishes within a generous bound, such as 200 ms.\n\n**Operator note:** after the run, list the open alerts with `gh api repos/en-dash-consulting/n-dx/code-scanning/alerts?state=open` and check that #124–#134 no longer reproduce on the PR 11 merge ref once CodeQL has run."
acceptanceCriteria:
  - "None of the eleven flagged patterns remains in the code"
  - "Each replacement passes the existing behaviour tests and a pathological-input test within the time bound"
  - "Lines longer than the cap are skipped and counted rather than parsed"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "lang-kit"
  - "security"
blockedBy:
  - "eb319918-d699-4f6f-99ce-1fc453155d70"
---
