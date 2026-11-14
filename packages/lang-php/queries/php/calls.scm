; Calls. @call.arguments is the argument list; @call.name is the called name
; as written and ends where the list opens; @call.receiver is the object or
; scope as written (`$this->db`, `Foo`, `self`, `parent`), absent for a
; function call. Inline HTML is never captured.
;
;   strlen($s)  \Foo\bar($s)        @call.name only
;   $db->query($sql)  $o?->m()      @call.receiver "$db", @call.name "query"
;   Foo::bar()  parent::__construct()  @call.receiver "Foo", @call.name "bar"
(function_call_expression
  function: [(name) (qualified_name) (relative_name)] @call.name
  arguments: (arguments) @call.arguments) @call.invocation

; A callee that is not a name (`$fn()`, `$handlers[0]()`, `f()()`) has no
; name, but still owns its argument list, so the pairing rule stays true.
(function_call_expression
  function: [
    (variable_name)
    (dynamic_variable_name)
    (subscript_expression)
    (parenthesized_expression)
    (function_call_expression)
    (member_call_expression)
    (nullsafe_member_call_expression)
    (scoped_call_expression)
    (object_creation_expression)
    (array_creation_expression)
    (string)
    (encapsed_string)
    (heredoc)
    (nowdoc)
  ]
  arguments: (arguments) @call.arguments) @call.invocation

(member_call_expression
  object: (_) @call.receiver
  name: (name) @call.name
  arguments: (arguments) @call.arguments) @call.invocation

(nullsafe_member_call_expression
  object: (_) @call.receiver
  name: (name) @call.name
  arguments: (arguments) @call.arguments) @call.invocation

(scoped_call_expression
  scope: (_) @call.receiver
  name: (name) @call.name
  arguments: (arguments) @call.arguments) @call.invocation

; A method named by a variable (`$o->$m()`, `Foo::$m()`): no name.
(member_call_expression
  name: [(variable_name) (dynamic_variable_name)]
  arguments: (arguments) @call.arguments) @call.invocation

(nullsafe_member_call_expression
  name: [(variable_name) (dynamic_variable_name)]
  arguments: (arguments) @call.arguments) @call.invocation

(scoped_call_expression
  name: [(variable_name) (dynamic_variable_name)]
  arguments: (arguments) @call.arguments) @call.invocation

; Object creation. Every `new` is a @call.construct, with its class as
; @call.class when the class is a name. With an argument list it is also an
; ordinary call, named by its class; `new Foo` with no list is a call of its
; own (groupCalls in @n-dx/lang-runtime).
(object_creation_expression) @call.construct

(object_creation_expression
  [(name) (qualified_name) (relative_name)] @call.class)

(object_creation_expression
  [(name) (qualified_name) (relative_name)] @call.name
  (arguments) @call.arguments) @call.invocation

(object_creation_expression
  [
    (variable_name)
    (dynamic_variable_name)
    (member_access_expression)
    (nullsafe_member_access_expression)
    (scoped_property_access_expression)
    (subscript_expression)
    (parenthesized_expression)
  ]
  (arguments) @call.arguments) @call.invocation

; @call.string_argument is one plain string literal passed as an argument:
; single-quoted, or double-quoted with no `$` (no interpolation). Pair it with
; its call by the innermost @call.arguments that contains it.
(arguments
  (argument
    (string) @call.string_argument))

(arguments
  (argument
    (encapsed_string) @call.string_argument)
  (#not-match? @call.string_argument "[$]"))
