---
"@n-dx/lang-kit": patch
---

`ndx analyze` now detects a PHP repository whose app sits one folder below the root, such as phpBB's `phpBB/` or osCommerce's `catalog/`, instead of falling back to TypeScript.

With no other language's marker at the root, a `composer.json` or `index.php` in a direct child directory marks PHP; detection never looks deeper. A repository with no marker at all takes the language with the most source files, PHP included, unless that is TypeScript or Terraform files match or outnumber it. Repositories with a root marker, such as `package.json` beside a `php/` folder, keep their detection.
