---
id: "f2a302a2-bb06-40b9-831a-3916923e0ee7"
type: "task"
title: "An IP allow-list written for Apache 2.2, or beside a denial, still drops its PHP docroot routes"
slug: "an-ip-allow-list-written-for-apache-2"
summary: "Admin folders limited to certain network addresses with the older Apache syntax are still left off the list of pages a PHP site serves. Reading that syntax too keeps those pages visible, marked as restricted."
description: "Found by the adversarial review of P10 (cd616ada). Verdict: should-fix, medium.\n\nScenario: an invented `admin/.htaccess` with the common dual-version idiom\n\n```\n<IfModule mod_authz_core.c>\n  Require ip 10.0.0.0/8\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n  Allow from 10.0.0.0/8\n</IfModule>\n```\n\n`parseHtaccess` (`packages/lang-php/src/php-htaccess.ts`) reads through `<IfModule>`, sees `Deny from all`, and denial wins over the restriction, so every page under `admin/` is dropped from routes with no notice. The same happens for a 2.2-only file (`Order deny,allow` / `Deny from all` / `Allow from <ip>`), and for `Require ip` beside `Require all denied` (sibling `Require` lines are `<RequireAny>`, so the named clients are served; `tests/unit/php-docroot.test.ts` currently pins this as denied). These pages are served to the named clients, the same reason P10 keeps `Require ip` routes.\n\nReachable: `ndx analyze` on any PHP site with such a file; `readDocrootRoutes` -> `DocrootAccess.access`. Not a regression: these routes were dropped before P10 too.\n\nOptions:\n1. (recommended) Read `Allow from <not all>` as a restriction when `Order` is `deny,allow` (Allow overrides Deny per mod_access_compat), and let a `Require ip|host|local` restriction win over `Require all denied` in the same file; with `Order allow,deny` + `Deny from all` it stays denied. Cost: Order parsing and a few unit cases. Risk: a mis-read Order lists pages that are denied; the notice still says restricted.\n2. Restriction always beats denial in one file. Cheaper, but lists pages `Order allow,deny` really denies.\n\nCite mod_access_compat (Order) and mod_authz_core (RequireAny) for the rules."
acceptanceCriteria:
  - "An .htaccess with `Order deny,allow`, `Deny from all` and `Allow from <ip>` keeps its directory's pages as routes with the restricted notice"
  - "The dual-version idiom (`Require ip` in `<IfModule mod_authz_core.c>`, `Deny from all` + `Allow from <ip>` in the negated block) keeps the pages as routes with one notice"
  - "`Require ip` beside `Require all denied` in one file is read as a restriction, and the unit test that pins it as denied is updated"
  - "`Order allow,deny` with `Deny from all` still drops the routes"
  - "A unit test in tests/unit/php-docroot.test.ts covers each case above"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-php"
  - "routes"
source: "ndx-adversarial-review"
---
