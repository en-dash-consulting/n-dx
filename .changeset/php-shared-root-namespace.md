---
"@n-dx/lang-php": patch
---

The PHP pack now names a library that shares your project's root namespace as an external. Before, `Acme\Shared\Money` from a Composer package, used beside your own `Acme\Billing`, counted as a missing class of your project, so it got neither an edge nor an external. Now it is the external `php:Acme`. A name counts as your project's only when the project declares its namespace or one of your autoload prefixes covers it. Missing classes under a project prefix, such as `Zend_` in Zend Framework 1, are still reported as missing project classes.
