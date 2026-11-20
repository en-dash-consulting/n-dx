---
id: "5e709987-9fd3-4e9f-8a0d-b4ba282c51c0"
type: "task"
title: "Try the entry script directories as PHP's working directory for relative includes"
slug: "try-the-entry-script-directories-as"
summary: "Old PHP apps include files relative to the folder of the page the browser requested, even from files deep inside includes/. Trying the folders that hold such pages lets osCommerce-style apps resolve those includes instead of reporting them as missing."
description: "Found by the operator's corpus hand-check after task fd220c20 (resolve report, oscommerce2: 186 of 777 includes computable but unresolved).\n\nPHP resolves a relative include path (`./x`, `../x`, and a bare path under the default include-path root `.`) against the working directory, which is the directory of the entry script the request started at, not the including file's directory. packages/lang-php/src/php-includes.ts approximates the working directory as the including file's directory, then the docroot, and the docroot is only one of lang-kit's PHP_DOCROOT_DIRECTORIES (public, web, htdocs, www, public_html) holding an index.php. Legacy apps keep their entry scripts elsewhere: osCommerce has catalog/index.php and catalog/admin/index.php. So catalog/admin/includes/application_top.php doing `require(DIR_WS_CLASSES . 'logger.php')` (= includes/classes/logger.php) is not found, although PHP finds catalog/admin/includes/classes/logger.php.\n\nFix: for every lookup that uses the working directory (relative `./`/`../` paths, relative include-path roots such as `.`, and the candidate starts of dynamic includes), try in order: the including file's directory, then each ancestor directory of the including file that holds an `index.php`, nearest first, then the docroot; the first existing file wins, as today. Record these with the existing `via` values (no new resolution kind unless the code needs one; if it adds one, the report's `by:` line shows it). Update the module doc comment's search-order section. Do not add entry-script detection beyond `index.php`, and do not change PHP_DOCROOT_DIRECTORIES.\n\nFixture: an osCommerce-shaped app with `shop/index.php`, `shop/admin/index.php`, `shop/admin/includes/application_top.php` including `'includes/classes/logger.php'` through a constant, and `shop/admin/includes/classes/logger.php`; expect the edge to the admin file. Also a case where the nearest index.php ancestor lacks the file and an outer one has it."
acceptanceCriteria:
  - "A relative include from a file below an entry directory resolves against the nearest ancestor holding index.php when the including directory and docroot do not have the file"
  - "Existing include fixtures resolve as before"
  - "Non-PHP output is byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "3679880e-8370-4938-9834-2fe6c87b8265"
---
