; Calls. @call.receiver is the object before the last dot as written (`os`,
; `os.path`, `self.repo`); it is absent for an unqualified call. @call.name
; is the called identifier or attribute. @call.arguments is the argument
; list, or the generator expression of `f(x for x in y)`.
;
; @call.string_argument is one string literal passed directly as a positional
; argument; an f-string is not a literal and is left out. Pair it with its
; call by the innermost @call.arguments that contains it: `f(g("x"))` gives
; "x" to g, not f.
(call
  function: (identifier) @call.name
  arguments: [(argument_list) (generator_expression)] @call.arguments) @call.invocation

(call
  function: (attribute
    object: (_) @call.receiver
    attribute: (identifier) @call.name)
  arguments: [(argument_list) (generator_expression)] @call.arguments) @call.invocation

; A callee that is not a name (`f()()`, `handlers[0]()`, `(fn)()`) has no
; name or receiver, but still owns its argument list, so the pairing rule
; above stays true.
(call
  function: [
    (call)
    (subscript)
    (parenthesized_expression)
  ]
  arguments: [(argument_list) (generator_expression)] @call.arguments) @call.invocation

(call
  arguments: (argument_list
    (string) @call.string_argument)
  (#not-match? @call.string_argument "^[A-Za-z]*[fF]"))
