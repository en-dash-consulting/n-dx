---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack no longer drops every PHP edge on deeply nested includes, long `define` chains or deeply nested closures.

An include path nested more than 32 sub-expressions deep, or a constant defined through a chain of more than 32 constants, is not evaluated: that include gives no edge and a `[php-too-deep]` notice counts them. A dynamic-code site more than 32 closures deep keeps its fact with its scope named to that depth, listed in a `[php-deep-scope]` notice. Before, each of these overflowed the stack and lost the whole repository's PHP facts.
