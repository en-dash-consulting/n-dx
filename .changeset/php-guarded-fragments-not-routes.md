---
"@n-dx/lang-php": patch
---

PHP docroot routes no longer list class files behind a direct-access guard, and `.htaccess` `Require ip` is read as a restriction.

A file whose first statement that is not a declaration (`namespace`, `use`, a class or function) is `defined('BASEPATH') OR exit;`, `defined('_JEXEC') or die;` or `if (!defined('ABSPATH')) exit;`, followed only by declarations and include or require lines, is an included fragment and is not a route. A guarded file that also prints or runs other top-level code stays a route.

`Require ip`, `Require host` and `Require local` without `Require all granted` keep their files as routes, since those pages are still served to the clients named, and add one notice per `.htaccess` saying how many routes it restricts. This holds beside `Require all denied`, and for Apache 2.2's `Order deny,allow`, `Deny from all`, `Allow from <ip>`, alone or in the dual-version `<IfModule mod_authz_core.c>` idiom. `Order allow,deny` with `Deny from all` still drops the files.
