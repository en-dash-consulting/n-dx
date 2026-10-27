; Blocks whose imports might not run. An import belongs to the innermost
; guard block containing it.
;
; @guard.type_checking is the body of `if TYPE_CHECKING:` or
; `if typing.TYPE_CHECKING:`; its `elif` and `else` branches are not guarded.
(if_statement
  condition: (identifier) @_name
  consequence: (block) @guard.type_checking
  (#eq? @_name "TYPE_CHECKING"))

(if_statement
  condition: (attribute
    object: (identifier) @_module
    attribute: (identifier) @_name)
  consequence: (block) @guard.type_checking
  (#eq? @_module "typing")
  (#eq? @_name "TYPE_CHECKING"))

; @guard.optional is the body of a `try:` with a handler that catches
; ImportError or ModuleNotFoundError: alone, parenthesized or in a tuple,
; each optionally bound with `as` (an as_pattern). Imports in the handlers
; themselves are not guarded.
(try_statement
  body: (block) @guard.optional
  (except_clause
    value: [
      (identifier) @_exception
      (parenthesized_expression (identifier) @_exception)
      (tuple (identifier) @_exception)
      (as_pattern [
        (identifier) @_exception
        (parenthesized_expression (identifier) @_exception)
        (tuple (identifier) @_exception)
      ])
    ])
  (#any-of? @_exception "ImportError" "ModuleNotFoundError"))
