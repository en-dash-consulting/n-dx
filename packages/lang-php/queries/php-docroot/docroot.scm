; What the docroot routes (src/php-docroot.ts) need beyond the PHP queries:
; each top-level statement of a file, and of a braced namespace's body, so a
; file holding only declarations (an included fragment, never a page) can be
; told from a page. Inline HTML outside `<?php … ?>` is a `text` or
; `text_interpolation` statement. Run only when routes are wanted.
(program (_) @docroot.top)

(namespace_definition (compound_statement (_) @docroot.top))

; A direct-access guard: ends the request when a constant the including
; script defines is missing. `exit` and `die` parse as an `exit_statement`, a
; bare `name` or a call, by context. php-docroot.ts reads these only where
; they start a top-level statement.
;   defined('BASEPATH') OR exit('No direct script access allowed');
;   \defined('_JEXEC') or die;
(expression_statement
  (binary_expression
    left: (function_call_expression function: [(name) (qualified_name)] @_defined)
    operator: ["or" "||"]
    right: [(name) @_exit (function_call_expression function: (name) @_exit)])
  (#match? @_defined "(^|\\\\)[Dd][Ee][Ff][Ii][Nn][Ee][Dd]$")
  (#match? @_exit "^([Ee][Xx][Ii][Tt]|[Dd][Ii][Ee])$")) @docroot.guard

;   if (!defined('ABSPATH')) exit;   if (!defined('ABSPATH')) { echo '…'; die(); }
; A block counts when it exits at its own top level: nothing after the guard runs.
; Two patterns: the exit-name predicate applies only where `exit`/`die` is a name.
(if_statement
  condition: (parenthesized_expression
    (unary_op_expression
      "!"
      argument: (function_call_expression function: [(name) (qualified_name)] @_defined)))
  body: [
    (exit_statement)
    (compound_statement (exit_statement))
  ]
  !alternative
  (#match? @_defined "(^|\\\\)[Dd][Ee][Ff][Ii][Nn][Ee][Dd]$")) @docroot.guard

(if_statement
  condition: (parenthesized_expression
    (unary_op_expression
      "!"
      argument: (function_call_expression function: [(name) (qualified_name)] @_defined)))
  body: [
    (expression_statement [(name) @_exit (function_call_expression function: (name) @_exit)])
    (compound_statement (expression_statement [(name) @_exit (function_call_expression function: (name) @_exit)]))
  ]
  !alternative
  (#match? @_defined "(^|\\\\)[Dd][Ee][Ff][Ii][Nn][Ee][Dd]$")
  (#match? @_exit "^([Ee][Xx][Ii][Tt]|[Dd][Ii][Ee])$")) @docroot.guard

; An include or require statement: allowed beside a guarded file's declarations.
(expression_statement [
  (include_expression)
  (include_once_expression)
  (require_expression)
  (require_once_expression)
]) @docroot.include
