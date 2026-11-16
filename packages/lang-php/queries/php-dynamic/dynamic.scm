; What the dynamic-code rules (src/php-dynamic-code.ts) read. Captures name
; the node a rule reads; whether it is a site is decided in code. Run only
; when dynamic code is wanted.

; ── Calls ──
; Every function call with its callee: a name (`eval`, `call_user_func`)
; or an expression (`$f`, `$handlers[$k]`), and every argument list, so an
; argument is paired with the innermost list holding it.
(function_call_expression
  function: (_) @dynamic.callee
  arguments: (arguments)) @dynamic.call
(arguments) @dynamic.arguments
(argument) @dynamic.argument
; An argument's own children: a named argument's name, then its value.
(argument (_) @dynamic.argument-value)
(array_creation_expression) @dynamic.array
(array_element_initializer (_) @dynamic.element)
(function_definition name: (name) @dynamic.declared)

; ── Methods and classes named by a value ──
; `$o->$m()`, `$o->{$expr}()`, `$o?->$m()`, `$c::$m()`, `$c::{$expr}()`:
; the name is not a (name) node. Decided in code.
(member_call_expression name: (_) @dynamic.method-name) @dynamic.method-call
(nullsafe_member_call_expression name: (_) @dynamic.method-name) @dynamic.method-call
(scoped_call_expression name: (_) @dynamic.static-name) @dynamic.static-call
(object_creation_expression
  [
    (variable_name)
    (dynamic_variable_name)
    (member_access_expression)
    (nullsafe_member_access_expression)
    (scoped_property_access_expression)
    (subscript_expression)
    (parenthesized_expression)
  ] @dynamic.class) @dynamic.new

; ── Scopes ──
(function_definition name: (name) @dynamic.function-name) @dynamic.function
(method_declaration name: (name) @dynamic.method-decl-name) @dynamic.method-decl
(class_declaration name: (name) @dynamic.type-name) @dynamic.type
(interface_declaration name: (name) @dynamic.type-name) @dynamic.type
(trait_declaration name: (name) @dynamic.type-name) @dynamic.type
(enum_declaration name: (name) @dynamic.type-name) @dynamic.type
(anonymous_class) @dynamic.anonymous-class
(anonymous_function) @dynamic.closure
(arrow_function) @dynamic.closure
