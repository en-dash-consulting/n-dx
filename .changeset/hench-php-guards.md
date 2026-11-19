---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`ndx work` in a PHP project now runs `php -l` on each changed PHP file and, when Composer files changed, `composer validate`; the test gate runs the project's own `vendor/bin/phpunit`.

Action needed: a PHP checkout (as detected below) is now judged against the PHP guard baseline (`php`, `composer`, `phpunit`, `git`). If its `.hench/config.json` was written with the JavaScript defaults, `ndx trust .` reports the extra commands; run `ndx trust accept .` to keep them, or replace the guard with the PHP defaults.

A project with a root `composer.json` is detected as PHP by `hench init` and by repository trust. When a root `package.json` sits beside it, the project is PHP only if it has more PHP files than JavaScript/TypeScript files, so a JavaScript app with a little PHP keeps its npm tools while a Laravel app stays PHP. A PHP project gets the PHP guard defaults and the new `php-project` template. Each check runs only when its prerequisite exists: `php -l` and `composer validate` need the tool on PATH, `composer validate` runs only when the change touched `composer.json` or `composer.lock`, and PHPUnit needs `phpunit.xml` or `phpunit.xml.dist` plus an installed `vendor/bin/phpunit`. n-dx installs nothing; a missing tool skips its check, and a run whose every check was skipped reports the PHP guards as skipped, with the reasons, not as passed. Each changed path reaches `php -l` as `./<path>`, so a file named like an option (`-zx.php`) is linted, never read as one. A failing `php -l` or `composer validate` fails the run, so the task is not marked done. These checks run even with `--skip-test-gate`.
