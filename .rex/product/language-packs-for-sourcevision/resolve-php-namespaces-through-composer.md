---
id: "532cf1ec-2850-4771-9a9e-446e5a36234c"
type: "capability"
title: "Resolve PHP namespaces through Composer"
slug: "resolve-php-namespaces-through-composer"
statement: "Sourcevision resolves PHP use imports and class references through Composer's PSR-4, PSR-0 and classmap rules into file-to-file import edges, and names unresolved packages as php:-namespaced externals."
criteria: [{"id":"php-composer-edges","text":"Composer projects get file edges from use imports and class references"},{"id":"php-externals","text":"Unresolved names become php: externals named as written, never PHP built-ins or extensions"}]
---

## History

- 2026-11-14 78cf4f7d-2b28-4263-bde2-bbc7995f7632 added: Resolve PHP namespaces through Composer
