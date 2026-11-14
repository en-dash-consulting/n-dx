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

; What an include's path may be built from (php-includes.ts), function
; names in any letter case as PHP reads them:
;
;   define('ROOT', dirname(__FILE__));       @include.define, @include.define_name, @include.define_value
;   const ROOT = __DIR__;                    @include.const, @include.const_name, @include.const_value
;   set_include_path('lib' . PATH_SEPARATOR . get_include_path());
;                                            @include.set, @include.set_path
;   ini_set('include_path', 'lib');          @include.ini, @include.ini_key, @include.ini_value
((function_call_expression
  function: (name) @_define
  arguments: (arguments
    .
    (argument . [(string) (encapsed_string)] @include.define_name)
    .
    (argument (_) @include.define_value .))) @include.define
  (#match? @_define "^[dD][eE][fF][iI][nN][eE]$"))

; File-level `const` only: a class constant is never a global one.
(program
  (const_declaration
    (const_element . (name) @include.const_name (_) @include.const_value .) @include.const))

((function_call_expression
  function: (name) @_set
  arguments: (arguments . (argument (_) @include.set_path .))) @include.set
  (#match? @_set "^[sS][eE][tT]_[iI][nN][cC][lL][uU][dD][eE]_[pP][aA][tT][hH]$"))

((function_call_expression
  function: (name) @_ini
  arguments: (arguments
    .
    (argument . [(string) (encapsed_string)] @include.ini_key)
    .
    (argument (_) @include.ini_value .))) @include.ini
  (#match? @_ini "^[iI][nN][iI]_[sS][eE][tT]$"))

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
