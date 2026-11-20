---
id: "96c36dff-2ec0-445a-9319-91d3f350c83c"
type: "task"
title: "P9: keep CodeIgniter's index.php/$1 front controller as a catch-all route"
slug: "p9-keep-codeigniter-s-index-php-1"
summary: "Makes the standard front-controller setup of a common PHP framework show up as a route instead of being dropped without a word."
description: "#1082 review P9 (medium), `packages/lang-php/src/php-htaccess.ts` (the literal-target check).\n\nTrigger: `RewriteRule ^(.*)$ index.php/$1 [L]` produces no catch-all route and no notice, because `/[$%]/` is tested against the whole target. The `index.php?/$1` form works.\n\nFix: take the target's file part as the text up to the first `/` after a `.php`, `?` or `#`, and test only that for `$`/`%`; `index.php/$1` is then a catch-all on `index.php` with the pattern as written. A target whose file part itself has a backreference still gives the existing notice.\n\nTests (invented `.htaccess`): `index.php/$1` and `index.php?/$1` both give a catch-all on `index.php`; `$1.php` still gives the notice."
acceptanceCriteria:
  - "index.php/$1 yields a catch-all route on index.php"
  - "A backreference in the file part still yields a notice"
priority: "medium"
run: {"tier":"light","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "routes"
---
