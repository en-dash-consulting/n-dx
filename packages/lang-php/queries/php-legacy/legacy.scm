; What the removed- and deprecated-construct rules (src/php-legacy.ts) read.
; Captures name the node a rule reads; which rule a capture is, and whether
; it counts, is decided in code. Run only when legacy constructs are wanted.

; ── Calls and declarations by name ──
; Every call of a function by name, and every function declaration (for
; `__autoload`). Which calls reach PHP's own function is decided in code
; (src/php-namespaces.ts, over definitions.scm).
(function_call_expression function: [(name) (qualified_name)] @legacy.call)
(function_definition name: (name) @legacy.function)

; ── Syntax the grammar still parses ──
; Call-time pass-by-reference: `f(&$x)`.
(argument (reference_modifier) @legacy.call-time-reference)
(cast_expression (cast_type) @legacy.cast)
; `"${var}"` and `"${expr}"` in a string or heredoc; `${…}` outside one is a
; variable variable, never deprecated, and so is `{${…}}` inside one (the
; complex syntax around a variable variable), captured to be left out.
(encapsed_string (dynamic_variable_name) @legacy.string-dollar-brace)
(heredoc_body (dynamic_variable_name) @legacy.string-dollar-brace)
(encapsed_string "{" . (dynamic_variable_name) @legacy.string-braced-variable)
(heredoc_body "{" . (dynamic_variable_name) @legacy.string-braced-variable)
(php_tag) @legacy.php-tag
; `==`, `!=`, `<>` with a string literal on one side and a number on the other.
(binary_expression
  left: [(string) (encapsed_string)] @legacy.compare-string
  operator: ["==" "!=" "<>"]
  right: [(integer) (float)])
(binary_expression
  left: [(integer) (float)]
  operator: ["==" "!=" "<>"]
  right: [(string) (encapsed_string)] @legacy.compare-string)

; ── Classes: PHP 4 constructors and dynamic properties ──
(class_declaration) @legacy.class
(anonymous_class) @legacy.anonymous-class
(class_declaration name: (name) @legacy.class-name)
(class_declaration (base_clause) @legacy.class-extends)
(class_declaration attributes: (attribute_list) @legacy.class-attributes)
(declaration_list (use_declaration) @legacy.class-trait)
(method_declaration name: (name) @legacy.method)
(property_element (variable_name (name) @legacy.property))
(property_promotion_parameter name: (variable_name (name) @legacy.property))
(assignment_expression
  left: (member_access_expression
    object: (variable_name) @_this
    name: (name) @legacy.this-assign)
  (#eq? @_this "$this"))
(namespace_definition name: (_)) @legacy.namespace
(namespace_definition body: (_) @legacy.namespace-body)

; ── Syntax the grammar no longer parses ──
; ASP tags and `<script language="php">` are inline HTML to this grammar.
; Every segment holding a `<script` or `</script` is captured too, so code
; can tell a JavaScript template's `<%` inside a script element from an ASP
; tag, across segments a PHP block splits.
((text) @legacy.inline-html
  (#match? @legacy.inline-html "<%|</?[Ss][Cc][Rr][Ii][Pp][Tt]"))
; A curly-brace offset `$s{0}` breaks the statement before its `{`: the
; statement or expression ends in a MISSING token, and the brace follows
; with no gap. Read in code.
(_
  (_ (MISSING) .) @legacy.brace-base
  .
  ["{" (compound_statement)] @legacy.brace-open)
(ERROR) @legacy.error
