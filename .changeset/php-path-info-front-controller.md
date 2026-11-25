---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack now records a CodeIgniter-style front controller, `RewriteRule ^(.*)$ index.php/$1 [L]`, as a catch-all route on `index.php`.

Before, a rewrite target with path info after `.php` gave no route and no notice. Only the target's file part (before `?`, `#` or a `/` after `.php`) is now checked for back-references. A target whose file itself comes from the request, such as `$1.php`, is reported in a notice instead of being dropped silently.
