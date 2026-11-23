---
id: "973d69dd-ecc6-4a80-8b4a-38f3fff87e09"
type: "task"
title: "Resolve un-namespaced PHP classes through a declared-type index and legacy autoloaders"
slug: "resolve-un-namespaced-php-classes"
summary: "Link old-style PHP class names like Zend_Db_Table to the files that declare them, using the naming conventions and hand-written autoloaders legacy code relies on."
description: "In `@n-dx/lang-php`, for code without Composer (or names Composer does not cover):\n\n- Build a declared-type index of every class, interface and trait declared in the repository (precedent: the declared-type index in packages/sourcevision/src/analyzers/csharp-imports.ts). A class reference (`new`, `::`, `extends`, `implements`, type hints, `instanceof`, `catch`) to a name declared exactly once resolves to that file.\n- PSR-0-style underscore names: `Vendor_Pkg_Class` resolves to `Vendor/Pkg/Class.php` under any include-path root (from the previous task) or the repository root, when that file exists.\n- Autoloaders: read `spl_autoload_register(...)` closures and named callbacks and `function __autoload($class)` bodies; when the body builds a path from a literal directory and the class name (`'lib/' . str_replace('_', '/', $class) . '.php'`, `__DIR__ . '/classes/' . $class . '.class.php'`), apply that pattern. Anything else is a notice with the autoloader's location.\n- A name declared more than once with no pattern to pick one stays unresolved and is counted.\n\nFixtures: a PEAR-style library under `lib/`, a hand-written `__autoload` with a `.class.php` suffix, an `spl_autoload_register` closure, and a duplicate class name."
acceptanceCriteria:
  - "Un-namespaced class references resolve through the declared-type index when the name is declared once"
  - "Underscore class names resolve through the PSR-0 directory convention under include-path roots"
  - "Literal directory patterns in spl_autoload_register and __autoload bodies are applied; other autoloaders produce a notice"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "09cd6ed9-0ee5-425d-b115-c852b316a558"
---
