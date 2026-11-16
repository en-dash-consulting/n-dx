; What the outbound-call rules (src/php-outbound.ts) need beyond the PHP
; queries. Run only when outbound calls are wanted. Names are matched in any
; case, as PHP matches function and method names.

; The client functions, one match per argument: @out.call is the call,
; @out.function its name as written, @out.argument each argument.
;
;   curl_init('https://a')     @out.function "curl_init", @out.argument "'https://a'"
(function_call_expression
  function: [(name) (qualified_name)] @out.function
  arguments: (arguments (argument) @out.argument)
  (#match? @out.function "^\\\\?([Cc][Uu][Rr][Ll]_[Ii][Nn][Ii][Tt]|[Cc][Uu][Rr][Ll]_[Ss][Ee][Tt][Oo][Pp][Tt]|[Cc][Uu][Rr][Ll]_[Ss][Ee][Tt][Oo][Pp][Tt]_[Aa][Rr][Rr][Aa][Yy]|[Ff][Ii][Ll][Ee]_[Gg][Ee][Tt]_[Cc][Oo][Nn][Tt][Ee][Nn][Tt][Ss]|[Ff][Oo][Pp][Ee][Nn]|[Ff][Ii][Ll][Ee]|[Gg][Ee][Tt]_[Hh][Ee][Aa][Dd][Ee][Rr][Ss]|[Ff][Ss][Oo][Cc][Kk][Oo][Pp][Ee][Nn]|[Gg][Ee][Tt][Ee][Nn][Vv])$")) @out.call

; Every `new` with arguments, @out.class its class as written: which class
; is a client is known only once the name is qualified (`use … as Http`).
(object_creation_expression
  [(name) (qualified_name)] @out.class
  (arguments (argument) @out.argument)) @out.call

; Guzzle's request methods, on a receiver as written (`$client`, `$this->http`).
(member_call_expression
  object: (_) @out.receiver
  name: (name) @out.method
  arguments: (arguments (argument) @out.argument)
  (#match? @out.method "^([Gg][Ee][Tt]|[Pp][Oo][Ss][Tt]|[Pp][Uu][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Hh][Ee][Aa][Dd]|[Oo][Pp][Tt][Ii][Oo][Nn][Ss]|[Rr][Ee][Qq][Uu][Ee][Ss][Tt])([Aa][Ss][Yy][Nn][Cc])?$")) @out.call

(nullsafe_member_call_expression
  object: (_) @out.receiver
  name: (name) @out.method
  arguments: (arguments (argument) @out.argument)
  (#match? @out.method "^([Gg][Ee][Tt]|[Pp][Oo][Ss][Tt]|[Pp][Uu][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Hh][Ee][Aa][Dd]|[Oo][Pp][Tt][Ii][Oo][Nn][Ss]|[Rr][Ee][Qq][Uu][Ee][Ss][Tt])([Aa][Ss][Yy][Nn][Cc])?$")) @out.call

; The array elements a client's options name its target with:
; `CURLOPT_URL => …` (curl_setopt_array), `'base_uri' => …` (Guzzle 6+),
; `'base_url' => …` (Guzzle 5), `'location' => …` (SoapClient without a WSDL).
(array_element_initializer
  .
  (_) @out.element_key
  .
  (_) @out.element_value
  (#match? @out.element_key "^(\\\\?CURLOPT_URL|'(base_uri|base_url|location)'|\"(base_uri|base_url|location)\")$")) @out.element

; What a variable or property is bound to: every assignment to one
; (@out.assigned), and each assignment of a `new` (@out.bound) with its
; variable or property (@out.bound_target) and class (@out.bound_class).
(assignment_expression
  left: [(variable_name) (member_access_expression)] @out.assigned)

(assignment_expression
  left: [(variable_name) (member_access_expression)] @out.bound_target
  right: (object_creation_expression [(name) (qualified_name)] @out.bound_class)) @out.bound

; `$_ENV[…]` and `$_SERVER[…]`, in code or interpolated in a string; a
; subscript that is assigned to or unset is a write (@out.written).
(subscript_expression
  (variable_name (name) @_superglobal)
  (#match? @_superglobal "^_(ENV|SERVER)$")) @out.superglobal

(assignment_expression left: (subscript_expression) @out.written)
(augmented_assignment_expression left: (subscript_expression) @out.written)
(reference_assignment_expression left: (subscript_expression) @out.written)
(unset_statement (subscript_expression) @out.written)
