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

(call_expression
  arguments: (argument_list
    [(interpreted_string_literal) (raw_string_literal)] @call.string_argument))
