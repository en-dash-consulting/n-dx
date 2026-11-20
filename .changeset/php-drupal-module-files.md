---
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

`ndx analyze` with the PHP pack now reads Drupal's `.module` and `.install` files, so their classes, includes and `eval` sites are reported.

Before, the pack skipped them: a class declared in a `.module` file (Drupal 7's `FieldException`) became a `php:` external, and `php_eval`'s `eval` went unreported. They count as PHP only in a repository detected as PHP; elsewhere they are still not inventoried, and analysis without the pack is unchanged. Drupal's `.theme`, `.profile`, `.engine` and `.test` files are still not read.
