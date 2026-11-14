; Regions whose code runs only under a condition. An include inside any of
; them carries the `conditional` guard (php-imports.ts).
;
; - The branches of `if`/`elseif`/`else` (braced, single-statement or the
;   alternative `if (…): … endif;` syntax), a `switch` body and loop bodies.
;   An `if (!function_exists('f'))` or `if (!defined('X'))` check is one.
; - A function, method, closure or arrow function body: it runs when called.
; - The right operand of `&&`, `||`, `and`, `or` and `??`, which short-circuit
;   (`function_exists('f') || require 'f.php';`), the branches of `?:` and the
;   arms of `match`. The left operand always runs: `require 'a.php' or die();`
;   is not guarded.
(if_statement body: (_) @guard.conditional)
(else_if_clause body: (_) @guard.conditional)
(else_clause body: (_) @guard.conditional)
(switch_statement body: (_) @guard.conditional)
(while_statement body: (_) @guard.conditional)
(do_statement body: (_) @guard.conditional)
(for_statement body: (_) @guard.conditional)
(foreach_statement body: (_) @guard.conditional)

(function_definition body: (_) @guard.conditional)
(method_declaration body: (_) @guard.conditional)
(anonymous_function body: (_) @guard.conditional)
(arrow_function body: (_) @guard.conditional)

(binary_expression
  operator: ["&&" "||" "and" "or" "??"]
  right: (_) @guard.conditional)
(conditional_expression body: (_) @guard.conditional)
(conditional_expression alternative: (_) @guard.conditional)
(match_block) @guard.conditional
