---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`ndx work` in a PHP project now runs `php -l` on each changed PHP file and `composer validate`, and the test gate runs the project's own `vendor/bin/phpunit`.

Action needed: a checkout with a root `composer.json` is now judged against the PHP guard baseline (`php`, `composer`, `phpunit`, `git`). If its `.hench/config.json` was written with the JavaScript defaults, `ndx trust .` reports the extra commands; run `ndx trust accept .` to keep them, or replace the guard with the PHP defaults.

A project with a root `composer.json` is detected as PHP by `hench init` and by repository trust, and gets the PHP guard defaults and the new `php-project` template. Each check runs only when its prerequisite exists: `php -l` and `composer validate` need the tool on PATH, and PHPUnit needs `phpunit.xml` or `phpunit.xml.dist` plus an installed `vendor/bin/phpunit`. n-dx installs nothing; a missing tool skips its check. A failing `php -l` or `composer validate` fails the run, so the task is not marked done. These checks run even with `--skip-test-gate`.
