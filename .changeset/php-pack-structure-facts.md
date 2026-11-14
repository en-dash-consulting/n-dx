---
"@n-dx/lang-php": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
"@n-dx/sourcevision": patch
---

The opt-in PHP pack (`ndx sv pack add php`) now reads each PHP file's includes, `use` imports, declarations and calls, including PHP 5 pages with HTML between `<?php` blocks.

Includes inside conditions, loops and functions are marked conditional. Imports are reported as written and not yet linked to files, so `imports.json` gains no PHP edges; with the pack installed, `ndx analyze` lists PHP among the analysed languages.
