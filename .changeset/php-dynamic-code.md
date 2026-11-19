---
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack, `sv analyze` reports each place PHP code runs a string as code or chooses what to run from a value.

These are the parts of a legacy app that reading its files alone cannot explain, such as routes kept in a database table or PHP stored in content.

Code run from a string: `eval`, `assert` with a string, `preg_replace` with the `/e` modifier and `create_function`, marked `literal` when the code is written as literals alone. Code chosen by a value: `call_user_func(_array)` and callback built-ins such as `array_map` and `usort` given a variable callable (`[$this, $name]`, never `[$this, 'save']` or a closure), `$f()`, `new $class`, `$obj->$method()` and `$class::$method()`. Each site comes with its file, line, the expression as written and the enclosing function or method, listed in the new `[php-dynamic-exec]` and `[php-dynamic-dispatch]` notices; never a value.

The profile's optional `ecosystem.php.dynamicCode` counts the sites (`sites`, in `files` files) by kind (`kinds`: `exec`, `dispatch`, and `include` for the includes whose path is built at run time) and by construct (`constructs`), with `literal` exec sites counted apart; `readiness.json` carries it. The lang-kit contract gains the `dynamicCode` fact kind (`DynamicCodeFact`, `DYNAMIC_CODE_KINDS`). A repository without the PHP pack, or without such a site, writes the same files as before.
