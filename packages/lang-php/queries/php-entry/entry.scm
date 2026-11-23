; What the CLI entry points (src/php-entry-points.ts) need beyond the PHP
; queries. Run only when entry points are wanted.

; The text before the first `<?php`: a `#!` shebang line when the file is a script.
(program . (text) @entry.lead)

; A comparison with PHP_SAPI or php_sapi_name(); the TypeScript checks the
; operator and that the other operand is the string 'cli'.
(binary_expression
  (name) @_constant
  (#eq? @_constant "PHP_SAPI")) @entry.sapi

(binary_expression
  (qualified_name (name) @_constant)
  (#eq? @_constant "PHP_SAPI")) @entry.sapi

(binary_expression
  (function_call_expression
    function: (_) @_function
    (#match? @_function "(^|\\\\)[Pp][Hh][Pp]_[Ss][Aa][Pp][Ii]_[Nn][Aa][Mm][Ee]$"))) @entry.sapi

; The command-line arguments: `$argv`, `$_SERVER['argv']`.
(variable_name
  (name) @entry.argv
  (#eq? @entry.argv "argv"))

(subscript_expression
  (variable_name (name) @_server (#eq? @_server "_SERVER"))
  [(string (string_content) @entry.argv) (encapsed_string (string_content) @entry.argv)]
  (#eq? @entry.argv "argv"))
