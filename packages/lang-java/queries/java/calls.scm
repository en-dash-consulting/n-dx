; Method invocations. @call.receiver is the expression before the dot as
; written (`repository`, `this`, `a.b()`, `Status`); it is absent for an
; unqualified call. @call.arguments is the argument list.
;
; @call.string_argument is one string literal (or text block) passed directly
; as an argument. Pair it with its call by the innermost @call.arguments that
; contains it: `f(g("x"))` gives "x" to g, not f.
(method_invocation
  object: (_)? @call.receiver
  name: (identifier) @call.name
  arguments: (argument_list) @call.arguments) @call.invocation

(method_invocation
  arguments: (argument_list
    (string_literal) @call.string_argument))
