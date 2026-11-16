; What the version-floor rules (src/php-compat.ts) read: each capture named
; @compat.<rule> is one use of the construct that rule dates; the others
; (primitive-type, this, closure-body, function-body, heredoc-end,
; attribute-group, attribute-next, error, recovered) are read in code. Run
; only when the version floor is wanted.
; Keywords are matched in any case, as PHP matches them.

; ── Parser error recovery ──
; A node inside an ERROR, beside an ERROR or MISSING node, or with one as a
; child is what recovery made of the source; it dates nothing.
(ERROR) @compat.error
(_ (ERROR)) @compat.recovered
(_ (MISSING)) @compat.recovered
(_ (ERROR) . _ @compat.recovered)
(_ _ @compat.recovered . (ERROR))
(_ (MISSING) . _ @compat.recovered)
(_ _ @compat.recovered . (MISSING))

; ── PHP 5.3 ──
(namespace_definition) @compat.namespaces
(namespace_use_declaration) @compat.namespaces
(qualified_name) @compat.namespaces
(relative_name) @compat.namespaces
(anonymous_function) @compat.closures
((name) @compat.dir-constant
  (#match? @compat.dir-constant "^__[Dd][Ii][Rr]__$"))
; `static::` and `new static`; a `static` return type is a named_type (8.0).
((relative_scope) @compat.late-static-binding
  (#match? @compat.late-static-binding "^[Ss][Tt][Aa][Tt][Ii][Cc]$"))
(object_creation_expression
  (name) @compat.late-static-binding
  (#match? @compat.late-static-binding "^[Ss][Tt][Aa][Tt][Ii][Cc]$"))
(goto_statement) @compat.goto
(nowdoc) @compat.nowdoc
(conditional_expression !body) @compat.short-ternary

; ── PHP 5.4 ──
(trait_declaration) @compat.traits
; `use T;` inside a class body.
(use_declaration) @compat.traits
((array_creation_expression) @compat.short-array
  (#match? @compat.short-array "^\\["))
; `$this` in a closure: the variable and the bodies it may sit in, the
; innermost deciding (src/php-compat.ts).
((variable_name) @compat.this
  (#eq? @compat.this "$this"))
(anonymous_function body: (_) @compat.closure-body)
(function_definition body: (_) @compat.function-body)
(method_declaration body: (_) @compat.function-body)
((php_tag) @compat.short-echo-tag
  (#eq? @compat.short-echo-tag "<?="))
(member_call_expression
  object: (parenthesized_expression (object_creation_expression))) @compat.instantiation-access
(member_access_expression
  object: (parenthesized_expression (object_creation_expression))) @compat.instantiation-access

; ── PHP 5.5 ──
(yield_expression) @compat.generators
(finally_clause) @compat.finally
(class_constant_access_expression
  (name) @compat.class-name-resolution .
  (#match? @compat.class-name-resolution "^[Cc][Ll][Aa][Ss][Ss]$"))
(foreach_statement
  (list_literal) @compat.foreach-list
  (#match? @compat.foreach-list "^[Ll][Ii][Ss][Tt]"))
(foreach_statement
  (pair (list_literal) @compat.foreach-list)
  (#match? @compat.foreach-list "^[Ll][Ii][Ss][Tt]"))

; ── PHP 5.6 ──
(variadic_parameter) @compat.variadics
(argument (variadic_unpacking) @compat.argument-unpacking)
(binary_expression operator: "**") @compat.exponentiation
(augmented_assignment_expression operator: "**=") @compat.exponentiation
(namespace_use_clause type: _) @compat.use-function-const
(namespace_use_declaration type: _) @compat.use-function-const
; A static value written as an expression; a literal, a constant and a
; negative number were static values before.
(const_element [(binary_expression) (conditional_expression)] @compat.constant-expressions)
(property_element default_value: [(binary_expression) (conditional_expression)] @compat.constant-expressions)
(simple_parameter default_value: [(binary_expression) (conditional_expression)] @compat.constant-expressions)
(static_variable_declaration value: [(binary_expression) (conditional_expression)] @compat.constant-expressions)

; ── PHP 7.0 ──
; Type keywords, read by name in code: scalar types (7.0), `void` and
; `iterable` (7.1), `object` (7.2), `mixed` (8.0).
(primitive_type) @compat.primitive-type
; The grammar reads `int`, `float`, `string`, `bool` and `object` as keywords
; only in lower case; `INT` or `String` is a named_type, which PHP still
; reads as the keyword.
(named_type (name) @compat.primitive-type)
(function_definition return_type: (_) @compat.return-types)
(method_declaration return_type: (_) @compat.return-types)
(anonymous_function return_type: (_) @compat.return-types)
(binary_expression operator: "??") @compat.null-coalescing
(binary_expression operator: "<=>") @compat.spaceship
(anonymous_class) @compat.anonymous-classes
(namespace_use_group) @compat.group-use

; ── PHP 7.1 ──
(optional_type) @compat.nullable-types
((list_literal) @compat.short-list
  (#match? @compat.short-list "^\\["))
(const_declaration (visibility_modifier)) @compat.class-constant-visibility
(catch_clause type: (type_list "|")) @compat.multi-catch

; ── PHP 7.3 ──
(arguments "," @compat.trailing-comma-in-calls . ")")
; An indented closing marker, read in code.
(heredoc end_tag: (heredoc_end) @compat.heredoc-end)
(nowdoc end_tag: (heredoc_end) @compat.heredoc-end)

; ── PHP 7.4 ──
(property_declaration type: (_)) @compat.typed-properties
(arrow_function) @compat.arrow-functions
(augmented_assignment_expression operator: "??=") @compat.null-coalescing-assignment
(array_element_initializer (variadic_unpacking)) @compat.array-spread

; ── PHP 8.0 ──
(match_expression) @compat.match
; Attribute groups and what follows their list, read in code: a group alone
; on its line is a `#` comment before 8.0.
(attribute_group) @compat.attribute-group
(_ (attribute_list) . _ @compat.attribute-next)
(argument name: (_)) @compat.named-arguments
(nullsafe_member_call_expression) @compat.nullsafe
(nullsafe_member_access_expression) @compat.nullsafe
(union_type) @compat.union-types
(property_promotion_parameter) @compat.constructor-promotion
((named_type) @compat.static-return-type
  (#match? @compat.static-return-type "^[Ss][Tt][Aa][Tt][Ii][Cc]$"))

; ── PHP 8.1 ──
(enum_declaration) @compat.enums
(property_declaration (readonly_modifier) @compat.readonly-properties)
(property_promotion_parameter (readonly_modifier) @compat.readonly-properties)
(bottom_type) @compat.never-type
(variadic_placeholder) @compat.first-class-callables
(simple_parameter default_value: (object_creation_expression) @compat.new-in-initializers)
(static_variable_declaration value: (object_creation_expression) @compat.new-in-initializers)
(const_element (object_creation_expression) @compat.new-in-initializers)
(attribute (arguments (argument (object_creation_expression) @compat.new-in-initializers)))
(intersection_type) @compat.intersection-types

; ── PHP 8.2 ──
(class_declaration (readonly_modifier) @compat.readonly-classes)
(disjunctive_normal_form_type) @compat.dnf-types

; ── PHP 8.3 ──
(const_declaration type: (_)) @compat.typed-class-constants
