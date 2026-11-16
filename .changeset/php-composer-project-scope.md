---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack now links each Composer app's classes to its own files when several apps in one repository map the same namespace.

A PHP file resolves classes through the autoload of the project that owns it (the nearest `composer.json`) and of the `path` repositories that project requires; a path package installed by a monorepo root, or a plugin with its own manifest inside another project, also sees that project's loader. The PSR-4, PSR-0 and classmap mappings, `composer.lock` package prefixes and the one-declaration fallback are all scoped this way. Before, every project's mappings were merged, so `new \App\Foo()` in `b/` could link to `a/src/Foo.php`. A file outside every Composer project, and a repository with a single project, resolve as before.
