; Includes and `use` imports, at any depth. Inline HTML (`text`) is never
; captured. A namespace declaration is a symbol (definitions.scm), not an
; import.
;
; Includes: @import.<form> spans the expression; @import.path is its path
; expression as written. `require_once("x.php")` writes its path in
; parentheses: @import.inner_path is the expression inside them, which
; php-imports.ts reports instead.
;
;   include 'a.php';                         @import.include, @import.path "'a.php'"
;   require_once(dirname(__FILE__) . '/b');  @import.require_once, @import.inner_path
;   include $file;                           @import.path "$file"
(include_expression (_) @import.path) @import.include
(include_once_expression (_) @import.path) @import.include_once
(require_expression (_) @import.path) @import.require
(require_once_expression (_) @import.path) @import.require_once

(include_expression (parenthesized_expression (_) @import.inner_path))
(include_once_expression (parenthesized_expression (_) @import.inner_path))
(require_expression (parenthesized_expression (_) @import.inner_path))
(require_once_expression (parenthesized_expression (_) @import.inner_path))

; `use` imports. @use.declaration spans the statement; each @use.clause is
; one imported name, with @use.name its name as written and @use.alias the
; `as` name. A group use (`use A\{B, C as D}`) has @use.prefix, its shared
; prefix. @use.type is the `function` or `const` keyword, on the statement
; (`use function A\f;`, `use const A\{X, Y};`) or on one clause of a group
; (`use A\{B, function f}`). A trait `use` inside a class body is another
; node (use_declaration) and is not captured.
(namespace_use_declaration) @use.declaration

(namespace_use_declaration
  (namespace_use_clause) @use.clause)

(namespace_use_declaration
  (namespace_name) @use.prefix
  body: (namespace_use_group
    (namespace_use_clause) @use.clause))

(namespace_use_clause
  .
  [(name) (qualified_name)] @use.name)

(namespace_use_clause
  alias: (name) @use.alias)

(namespace_use_declaration
  type: _ @use.type)

(namespace_use_clause
  type: _ @use.type)
