---
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack, `components.json` `serverRoutes` now lists a legacy PHP site's URLs: each page under its document root and each `.htaccess` front controller.

A document root is a `public/`, `web/`, `htdocs/`, `www/` or `public_html/` directory holding `index.php` (one per application), else the repository root holding `index.php`. Each `.php` or `.phtml` page under it is a `GET` and `POST` route at its URL. Files named `*.inc.php`, files holding only function and class declarations, and files `.htaccess` denies (`Deny from all`, `Require all denied`, `<Files>`/`<FilesMatch>`, `RedirectMatch 403`) are left out. A `RewriteRule` or `FallbackResource` that sends requests to a PHP file is a catch-all route on that file, with its pattern as written. Each route's new `source` field names the docroot or the `.htaccess` line it came from. Without the PHP pack, `components.json` is unchanged.
