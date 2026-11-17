---
id: "e8389da6-6103-4c66-9144-c21e3e98a55f"
type: "task"
title: "Count the long superglobal arrays and HTTP_RAW_POST_DATA as legacy PHP constructs"
slug: "count-the-long-superglobal-arrays-and"
summary: "Add two more pieces of very old PHP that later versions removed to the list the analysis counts."
description: "**Problem.** `packages/lang-php/src/php-legacy.ts` counts removed and deprecated constructs (`mysql_*`, `ereg*`/`split`, `each`, `create_function`, PHP 4 constructors, ASP tags, short open tags as a notice). The long superglobal arrays `$HTTP_GET_VARS`, `$HTTP_POST_VARS`, `$HTTP_COOKIE_VARS`, `$HTTP_SERVER_VARS`, `$HTTP_ENV_VARS`, `$HTTP_SESSION_VARS` and `$HTTP_POST_FILES` (register_long_arrays: deprecated in 5.3, removed in 5.4) are common in PHP 4/5 code and are not counted. Neither is `$HTTP_RAW_POST_DATA` (deprecated 5.6, removed 7.0).\n\n**Fix.** Add rules for both, in the existing rule shape: every version with its php.net page (the 5.3 deprecation and 5.4 removal pages for register_long_arrays; the 5.6 deprecation and 7.0 removal pages for `$HTTP_RAW_POST_DATA`). Count variable uses (reads and writes), including inside `global $HTTP_POST_VARS;` and inside double-quoted strings if the existing rules handle interpolation; a property or array key that merely shares the name is not a use.\n\n**Tests:** extend the existing legacy-constructs fixture/golden with invented uses; the counts and version floor change only as these rules require.\n\n`var` properties stay uncounted: `var` is valid PHP."
acceptanceCriteria:
  - "$HTTP_*_VARS and $HTTP_POST_FILES uses are counted with their 5.3/5.4 php.net sources"
  - "$HTTP_RAW_POST_DATA uses are counted with their 5.6/7.0 php.net sources"
  - "A same-named property or array key is not counted"
priority: "high"
run: {"tier":"light","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-php"
  - "estate-readiness"
  - "php-pr12"
blockedBy:
  - "7ffab98a-95f7-4d90-86df-e3aad31a3a3c"
---
