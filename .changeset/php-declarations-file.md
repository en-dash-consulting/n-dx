---
"@n-dx/sourcevision": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/web": patch
---

With the PHP pack, `sv analyze` now writes `declarations.json`: each PHP file's namespace and the classes, interfaces, traits and enums it declares, with the short name, fully qualified name and line. A class nothing imports, which imports.json never shows, is listed too.

A class declared inside an `if` block is listed; an anonymous class is not. A file with no namespace has an empty `namespaces` list. The file carries `schemaVersion`, is byte-identical across runs, and is not written (a stale one is removed) when no pack reports declarations, so a repository without PHP is unchanged.
