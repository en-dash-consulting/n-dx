---
"@n-dx/lang-php": patch
"@n-dx/lang-runtime": patch
"@n-dx/lang-kit": patch
"@n-dx/sourcevision": patch
---

PHP 5 files that use `$s{0}` string offsets now keep their includes, calls and symbols, and `imports.json` reports them under `summary.parseIssues.php.legacySyntax`, not as syntax errors.

The PHP 8 grammar cannot parse the curly-brace offset, so these valid legacy files used to lose facts and count as broken. The PHP pack now rewrites each offset to `$s[0]` in place, at the same length so every position is the source's, and parses again. `legacySyntax` counts the files and the rewrites by construct (`brace-offset`), and each offset still counts once as a `curly-offset` legacy construct. Short open tags and `each()` were never parse failures; they stay legacy-construct facts.
