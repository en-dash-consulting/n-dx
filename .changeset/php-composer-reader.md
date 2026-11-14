---
"@n-dx/lang-kit": patch
---

Internal: lang-kit reads Composer metadata as text, for the PHP pack's namespace resolver.

`readComposerProjects` gives one model per `composer.json` in the inventory (a manifest inside another project's vendor directory excluded): name, `require` and `require-dev` as written, `autoload` and `autoload-dev` (PSR-4, PSR-0, classmap, files, exclude-from-classmap) with repository-relative paths, repositories, the vendor directory, and the packages of the `composer.lock` beside it with their autoload blocks. Composer is never run. Malformed JSON or a field of the wrong type is a notice, never an exception.
