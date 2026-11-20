---
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

PHP sites whose document root is a prefixed `htdocs` folder (`default_htdocs`, `public_htdocs`) or Plesk's `httpdocs` now get their pages and `.htaccess` front controllers in `components.json` `serverRoutes`.

Only a folder named exactly `public`, `web`, `htdocs`, `www` or `public_html` used to count, so such a site had no routes at all. When no document root is found, the PHP pack now says so in one notice. Analyze prints one line counting the files served from each document root.
