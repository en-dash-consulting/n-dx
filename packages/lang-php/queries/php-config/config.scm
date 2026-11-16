; What the config-read and flag-check rules (src/php-config.ts) need beyond
; the PHP queries. Run only when config reads or flag checks are wanted.
; Function and method names are matched in any case, as PHP matches them.

; Conditions and the code they control: @cfg.gate is the `if`, `elseif`,
; ternary or `match`, @cfg.condition its condition, @cfg.body its first
; branch (absent for `?:`).
(if_statement condition: (_) @cfg.condition body: (_) @cfg.body) @cfg.gate
(else_if_clause condition: (_) @cfg.condition body: (_) @cfg.body) @cfg.gate
(conditional_expression condition: (_) @cfg.condition) @cfg.gate
(match_expression condition: (_) @cfg.condition body: (_) @cfg.body) @cfg.gate

; Argument lists, @cfg.callee the function, method or class they belong to:
; a value inside one is the call's input, not the condition's, unless the
; call only tests it (`isset`, `empty`; src/php-config.ts).
(function_call_expression function: (_) @cfg.callee arguments: (arguments) @cfg.arguments)
(member_call_expression name: (_) @cfg.callee arguments: (arguments) @cfg.arguments)
(nullsafe_member_call_expression name: (_) @cfg.callee arguments: (arguments) @cfg.arguments)
(scoped_call_expression name: (_) @cfg.callee arguments: (arguments) @cfg.arguments)
(object_creation_expression [(name) (qualified_name)] @cfg.callee (arguments) @cfg.arguments)

; A constant read as a value: alone, negated, an operand, an argument, an
; assigned, returned, echoed or array value, a `match` arm.
(parenthesized_expression (name) @cfg.name)
(unary_op_expression argument: (name) @cfg.name)
(binary_expression left: (name) @cfg.name)
(binary_expression right: (name) @cfg.name)
(conditional_expression condition: (name) @cfg.name)
(conditional_expression body: (name) @cfg.name)
(conditional_expression alternative: (name) @cfg.name)
; The only child: a named argument's label (`f(enabled: true)`) is a name too.
(argument . (name) @cfg.name .)
(assignment_expression right: (name) @cfg.name)
(array_element_initializer (name) @cfg.name)
(echo_statement (name) @cfg.name)
(return_statement (name) @cfg.name)
(match_condition_list (name) @cfg.name)

; Calls with a first argument (@cfg.argument): flag helpers, `defined`,
; `getenv`, Laravel's `config`, and the settings-file loaders.
(function_call_expression
  function: [(name) (qualified_name)] @cfg.function
  arguments: (arguments . (argument) @cfg.argument)
  (#match? @cfg.function "^\\\\?([Dd][Ee][Ff][Ii][Nn][Ee][Dd]|[Ii][Ss][Ee][Nn][Aa][Bb][Ll][Ee][Dd]|[Ff][Ee][Aa][Tt][Uu][Rr][Ee]|[Ii][Ss][Ff][Ee][Aa][Tt][Uu][Rr][Ee][Ee][Nn][Aa][Bb][Ll][Ee][Dd]|[Gg][Ee][Tt][Ee][Nn][Vv]|[Cc][Oo][Nn][Ff][Ii][Gg]|[Pp][Aa][Rr][Ss][Ee]_[Ii][Nn][Ii]_[Ff][Ii][Ll][Ee]|[Yy][Aa][Mm][Ll]_[Pp][Aa][Rr][Ss][Ee]_[Ff][Ii][Ll][Ee]|[Ss][Ii][Mm][Pp][Ll][Ee][Xx][Mm][Ll]_[Ll][Oo][Aa][Dd]_[Ff][Ii][Ll][Ee])$")) @cfg.call

; Flag helper and SDK methods, and settings registries' readers
; (`$this->config->item('x')`), on a receiver as written.
(member_call_expression
  object: (_) @cfg.receiver
  name: (name) @cfg.method
  arguments: (arguments . (argument) @cfg.argument)
  (#match? @cfg.method "^([Ii][Ss][Ee][Nn][Aa][Bb][Ll][Ee][Dd]|[Ii][Ss][Ff][Ee][Aa][Tt][Uu][Rr][Ee][Ee][Nn][Aa][Bb][Ll][Ee][Dd]|[Ii][Ss][Aa][Cc][Tt][Ii][Vv][Ee]|[Vv][Aa][Rr][Ii][Aa][Tt][Ii][Oo][Nn]|[Ii][Tt][Ee][Mm]|[Gg][Ee][Tt]|[Rr][Ee][Aa][Dd])$")) @cfg.call

(nullsafe_member_call_expression
  object: (_) @cfg.receiver
  name: (name) @cfg.method
  arguments: (arguments . (argument) @cfg.argument)
  (#match? @cfg.method "^([Ii][Ss][Ee][Nn][Aa][Bb][Ll][Ee][Dd]|[Ii][Ss][Ff][Ee][Aa][Tt][Uu][Rr][Ee][Ee][Nn][Aa][Bb][Ll][Ee][Dd]|[Ii][Ss][Aa][Cc][Tt][Ii][Vv][Ee]|[Vv][Aa][Rr][Ii][Aa][Tt][Ii][Oo][Nn]|[Ii][Tt][Ee][Mm]|[Gg][Ee][Tt]|[Rr][Ee][Aa][Dd])$")) @cfg.call

; Static registry readers (`Config::get('a.b')`, `Configure::read`) and
; Symfony's `Yaml::parseFile`, @cfg.scope the class as written.
(scoped_call_expression
  scope: [(name) (qualified_name)] @cfg.scope
  name: (name) @cfg.static_method
  arguments: (arguments . (argument) @cfg.argument)
  (#match? @cfg.static_method "^([Gg][Ee][Tt]|[Rr][Ee][Aa][Dd]|[Pp][Aa][Rr][Ss][Ee][Ff][Ii][Ll][Ee])$")) @cfg.call

; Array reads (`$config['a']['b']`, `$_ENV['X']`); nested subscripts are
; each captured, the outermost being the read. One assigned to, or unset,
; is a write (@cfg.written).
(subscript_expression) @cfg.subscript
(assignment_expression left: (subscript_expression) @cfg.written right: (_) @cfg.written_value) @cfg.write
(augmented_assignment_expression left: (subscript_expression) @cfg.written)
(reference_assignment_expression left: (subscript_expression) @cfg.written)
(unset_statement (subscript_expression) @cfg.written)

; Keyed array elements (`'key' => value`), for the keys a settings array holds.
(array_element_initializer
  .
  (_) @cfg.element_key
  .
  (_) @cfg.element_value) @cfg.element

; A settings file's returned array: `return [ … ];` at the top level.
(program (return_statement (array_creation_expression) @cfg.returned))

; A variable assigned an include's or a settings loader's result
; (`$cfg = require 'config.php';`, `$ini = parse_ini_file('app.ini');`).
(assignment_expression
  left: (variable_name) @cfg.bound_variable
  right: [(include_expression) (include_once_expression) (require_expression) (require_once_expression) (function_call_expression) (scoped_call_expression)] @cfg.bound_value) @cfg.bound
