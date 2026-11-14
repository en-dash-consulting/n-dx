---
id: "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
type: "capability"
title: "PHP structure through tree-sitter"
slug: "php-structure-through-tree-sitter"
statement: "The opt-in @n-dx/lang-php pack parses PHP, including PHP 5 code mixed with HTML, with a pinned tree-sitter-php grammar and reports each file's includes, namespaces, use imports, declarations and calls, measured against a pinned PHP corpus."
criteria: [{"id":"php-structure","text":"PHP files yield import, symbol and call facts that match committed goldens"},{"id":"php-clean-parse","text":"The corpus clean-parse rate is reported per repository"}]
---

## History

- 2026-11-14 fd04acac-099e-4ea0-8364-84298a85678a added: @n-dx/lang-php pack: grammar and structure facts
