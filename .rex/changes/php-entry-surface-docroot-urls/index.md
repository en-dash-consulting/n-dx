---
id: "238cd947-069f-4b9f-980c-9c800c2cafae"
type: "change"
title: "PHP entry surface: docroot URLs, .htaccess and CLI entries"
slug: "php-entry-surface-docroot-urls"
summary: "List the ways into a PHP application: every page reachable under the web root, the routes an .htaccess front controller sends to index.php, and command-line and cron scripts. A migration needs this list to know what each legacy repository actually serves."
intent: "PR 5 of the PHP language-pack stack, stacked on PR 4. Legacy PHP has no route table: each `.php` file under the document root is a URL, `.htaccess` rewrites send traffic to a front controller, and cron/CLI scripts are entry points too. The pack reports these as route facts that land in components.json `serverRoutes` the way Python and Spring routes do, plus entry-point marks for CLI and cron scripts.\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- Analyze output stays byte-identical for every repository without PHP files, and for PHP repositories without the pack.\n- LS16: .htaccess and crontab files are read as text; no web server is run.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "Each reachable .php file under the detected document root is reported as a URL route with its handler file"
  - ".htaccess front-controller rewrites and denied directories are reflected in the route list"
  - "CLI and cron PHP scripts are marked as entry points"
amends: [{"target":"461f9855-cb81-4dd4-a457-7d58841a7502","delta":"added","summary":"PHP entry surface: docroot URLs, .htaccess and CLI entries","criteria":{"add":[{"id":"php-routes","text":"Docroot files and .htaccess front controllers appear as server routes with their handler files"},{"id":"php-cli-entries","text":"CLI and cron PHP scripts are marked as entry points"}]},"proposed":"Sourcevision lists a PHP application's entry points: each reachable file under its document roots as a URL route, .htaccess front-controller routes, and CLI and cron scripts.","under":"58f0468b-33ce-46ee-b507-c95261f152b6","title":"PHP entry surface","type":"capability"}]
priority: "medium"
tags:
  - "php"
  - "lang-php"
  - "php-pr5"
blockedBy:
  - "2de61a9f-a479-4873-b203-9f38169e7401"
---
