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

; ── Methods and classes named by a value ──
; `$o->$m()`, `$o->{$expr}()`, `$o?->$m()`, `$c::$m()`, `$c::{$expr}()`:
; the name is not a (name) node. Decided in code.
(member_call_expression object: (_) @dynamic.method-object name: (_) @dynamic.method-name) @dynamic.method-call
(nullsafe_member_call_expression object: (_) @dynamic.method-object name: (_) @dynamic.method-name) @dynamic.method-call
(scoped_call_expression scope: (_) @dynamic.static-scope name: (_) @dynamic.static-name) @dynamic.static-call
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
(namespace_definition name: (namespace_name) @dynamic.namespace-name) @dynamic.namespace

; ── Database flow (src/php-database-flow.ts) ──
; Where a value goes: assignments (`=`, `= &`, `.=`), destructuring,
; `foreach`, `global` and `return`.
(assignment_expression left: (_) @dynamic.assign-left right: (_) @dynamic.assign-right) @dynamic.assign
(reference_assignment_expression left: (_) @dynamic.assign-left right: (_) @dynamic.assign-right) @dynamic.assign
(augmented_assignment_expression left: (_) @dynamic.append-left operator: ".=" right: (_) @dynamic.append-right) @dynamic.append
(list_literal (variable_name) @dynamic.list-variable) @dynamic.list
(foreach_statement (_) @dynamic.foreach-subject . "as" . [
  (variable_name) @dynamic.foreach-value
  (pair (variable_name) @dynamic.foreach-value .)
  (by_ref (variable_name) @dynamic.foreach-value)
  (pair (by_ref (variable_name) @dynamic.foreach-value) .)
]) @dynamic.foreach
(global_declaration (variable_name) @dynamic.global)
(return_statement (_) @dynamic.return-value) @dynamic.return
; How a value is read: `$row['x']`, `$row->x`, `( … )`, `.` and interpolation.
(subscript_expression . (_) @dynamic.subscript-base) @dynamic.subscript
(member_access_expression object: (_) @dynamic.member-object) @dynamic.member
(nullsafe_member_access_expression object: (_) @dynamic.member-object) @dynamic.member
; Which element or property: provenance is kept per `$a['k']` and `$o->p`.
(subscript_expression . (_) . (_) @dynamic.subscript-index) @dynamic.indexed
(member_access_expression name: (_) @dynamic.member-name) @dynamic.named-member
(nullsafe_member_access_expression name: (_) @dynamic.member-name) @dynamic.named-member
(parenthesized_expression (_) @dynamic.parenthesized-inner) @dynamic.parenthesized
(binary_expression left: (_) @dynamic.concat-operand operator: "." right: (_) @dynamic.concat-operand) @dynamic.concat
(encapsed_string (_) @dynamic.interpolated-part) @dynamic.interpolated
(heredoc value: (heredoc_body (_) @dynamic.interpolated-part)) @dynamic.interpolated
; A client's class: `new PDO(…)`, `new \mysqli(…)`.
(object_creation_expression [(name) (qualified_name)] @dynamic.new-name) @dynamic.new-named
