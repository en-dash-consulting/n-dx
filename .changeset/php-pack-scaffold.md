---
"@n-dx/lang-php": patch
"@n-dx/lang-runtime": patch
"@n-dx/sourcevision": patch
---

`ndx sv pack add php` installs the new opt-in `@n-dx/lang-php` pack, and `ndx analyze` suggests it for PHP repositories in its `Optional packs` line.

The pack parses PHP, including PHP 5 pages with `<?php … ?>` blocks between HTML, with a pinned tree-sitter-php 0.25.1 grammar. Without the pack, PHP files get inventory only and analyze output is unchanged. The grammar build script can now build a grammar from a subdirectory of its release archive.
