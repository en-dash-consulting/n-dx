---
id: "3a05f5ae-c70a-4380-af5d-2f0ff142d000"
type: "task"
title: "Report docroot PHP files and .htaccess front controllers as routes"
slug: "report-docroot-php-files-and-htaccess"
summary: "List every page a legacy PHP site serves straight from its web folder, plus the URLs an .htaccess file sends to a front controller, as the routes n-dx shows for other frameworks."
description: "In `@n-dx/lang-php`, produce route facts that land in components.json `serverRoutes` the same way the Python and Spring framework packs' routes do (read how `@n-dx/lang-python`'s fastapi/flask/django packs report routes and follow that path; do not add a separate route convention to sourcevision's route-convention code).\n\n- Docroot detection, in order: a `public/`, `web/`, `htdocs/`, `www/` or `public_html/` directory holding an `index.php`; else the repository root when it holds `index.php`. A repository may have several docroots (one per app directory); report each.\n- Each `.php`/`.phtml` file under a docroot is a route `GET|POST <url path>` handled by that file, except files in directories denied by `.htaccess` (`Deny from all`, `Require all denied`, `RedirectMatch 403`) and files that are clearly included fragments (no top-level statements outside function/class declarations, or named `*.inc.php`).\n- `.htaccess` front controllers: `RewriteRule` lines whose target is a `.php` file (classically `^(.*)$ index.php?q=$1 [L,QSA]`, `FallbackResource /index.php`) produce one catch-all route per pattern handled by that file, with the pattern as written.\n- Routes carry provenance (docroot convention or the `.htaccess` line).\n\nFixtures: a flat PHP 5 site with an `admin/` directory denied by `.htaccess`, a Drupal 7-style front controller, and a `public/index.php` app."
acceptanceCriteria:
  - "Each reachable .php file under each detected docroot is a route with its handler file"
  - ".htaccess rewrite and FallbackResource front controllers produce catch-all routes, and denied directories are excluded"
  - "Routes reach components.json serverRoutes only for PHP repositories with the pack"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "routes"
---
