; Call expressions. @call.receiver is the operand before the dot as written
; (`fmt`, `a.b`, `s.repo`); it is absent for an unqualified call. @call.name
; is the called identifier or selected field. @call.arguments is the
; argument list.
;
; @call.string_argument is one string literal (interpreted or raw) passed
; directly as an argument. Pair it with its call by the innermost
; @call.arguments that contains it: `f(g("x"))` gives "x" to g, not f.
(call_expression
  function: (identifier) @call.name
  arguments: (argument_list) @call.arguments) @call.invocation

(call_expression
  function: (selector_expression
    operand: (_) @call.receiver
    field: (field_identifier) @call.name)
  arguments: (argument_list) @call.arguments) @call.invocation

; Any other callable function kind (`f()("z")`, `h[0]("z")`, `v.(F)("z")`,
; `(fn)("z")`, `func() {}("z")`) has no name or receiver, but still owns its
; argument list, so the pairing rule above stays true. Where the index could
; be a type (`h[k]("z")`, `pkg.F[int]("z")`) or the callee is a type
; (`[]byte("z")`), tree-sitter-go parses a type conversion: no argument_list,
; so no string argument.
(call_expression
  function: [
    (call_expression)
    (index_expression)
    (slice_expression)
    (type_assertion_expression)
    (type_instantiation_expression)
    (parenthesized_expression)
    (func_literal)
  ]
  arguments: (argument_list) @call.arguments) @call.invocation

(call_expression
  arguments: (argument_list
    [(interpreted_string_literal) (raw_string_literal)] @call.string_argument))
