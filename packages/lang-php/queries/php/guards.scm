; Regions whose code runs only under a condition. An include inside any of
; them carries the `conditional` guard (php-imports.ts).
;
; - The branches of `if`/`elseif`/`else` (braced, single-statement or the
;   alternative `if (…): … endif;` syntax), a `switch` body and loop bodies.
;   An `if (!function_exists('f'))` or `if (!defined('X'))` check is one.
; - A function, method, closure or arrow function body: it runs when called.
;   Captured as @guard.function, because it is also a variable scope: a
;   variable assigned outside it is another variable (php-assignments.ts).
; - The right operand of `&&`, `||`, `and`, `or`, `??` and `??=`, which
;   short-circuit (`function_exists('f') || require 'f.php';`,
;   `$config ??= include 'config.php';`), the branches of `?:` and the
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

(function_definition body: (_) @guard.function)
(method_declaration body: (_) @guard.function)
(anonymous_function body: (_) @guard.function)
(arrow_function body: (_) @guard.function)

(binary_expression
  operator: ["&&" "||" "and" "or" "??"]
  right: (_) @guard.conditional)
(augmented_assignment_expression
  operator: "??="
  right: (_) @guard.conditional)
(conditional_expression body: (_) @guard.conditional)
(conditional_expression alternative: (_) @guard.conditional)
(match_block) @guard.conditional
