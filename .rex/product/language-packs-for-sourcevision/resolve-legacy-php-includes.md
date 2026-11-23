---
id: "76778b68-080b-4c18-83e7-f4c4e0407291"
type: "capability"
title: "Resolve legacy PHP includes"
slug: "resolve-legacy-php-includes"
statement: "Sourcevision resolves include and require statements in PHP code without Composer through literal paths, include-path roots, PSR-0 style class names and literal autoloader patterns, and reports dynamic includes as notices with literal-prefix candidates that are never import edges."
criteria: [{"id":"php-include-edges","text":"Computable includes and legacy class names resolve to file edges"},{"id":"php-dynamic-includes","text":"Dynamic includes are counted with locations, never guessed"}]
---

## History

- 2026-11-16 2de61a9f-a479-4873-b203-9f38169e7401 added: Resolve legacy PHP includes
