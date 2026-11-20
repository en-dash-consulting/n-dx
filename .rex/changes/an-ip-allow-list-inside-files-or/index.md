---
id: "d7b399c7-f0df-44b8-bd3d-c827283d57af"
type: "change"
title: "An IP allow-list inside `<Files>` or `<FilesMatch>` still drops the matched PHP docroot routes"
slug: "an-ip-allow-list-inside-files-or"
summary: "A single page limited to certain network addresses, rather than a whole folder, is still left off the list of pages a PHP site serves. Reading that case the same way as folders keeps the page visible, marked as restricted."
intent: "Found by the adversarial review of f2a302a2 (commit 7d32b4646). Verdict: out-of-scope (pre-existing), medium.\n\nScenario: an invented `.htaccess`\n\n```\n<Files \"admin.php\">\n  Order deny,allow\n  Deny from all\n  Allow from 10.0.0.0/8\n</Files>\n```\n\n`parseHtaccess` (`packages/lang-php/src/php-htaccess.ts`, the `files !== undefined` branch of the access-rule block) pushes a `fileDenial` for every `Deny from all` / `Require all denied` line in a `<Files>`/`<FilesMatch>` block and reads nothing else there, so `admin.php` is dropped from routes with no notice. The same happens for `Require ip 10.0.0.0/8` beside `Require all denied` in the block, and for the dual-version `<IfModule mod_authz_core.c>` idiom nested in it. The file is served to the named clients: the directory-level rules (Order per mod_access_compat, sibling `Require` as `<RequireAny>`, joined as `Satisfy All`) already keep such pages since 7d32b4646, but only outside `<Files>`. The module comment says \"A restriction inside them is not read\".\n\nReachable: `ndx analyze` on a PHP site with such a block; `readDocrootRoutes` -> `DocrootAccess.access` -> `fileDenials`. Pre-existing: file-level denials behaved this way before 7d32b4646.\n\nOptions:\n1. (recommended) Collect each block's access lines into the same two `AccessLines` models as the directory, evaluate with `requireAccess`/`compatAccess`/`joinAccess` when the block closes, and push a file denial only when the result is denied. A restricted result keeps the file a route; either count it in the `.htaccess`'s restricted notice or add a per-block notice. Cost: per-container state in the parser and unit cases. Risk: `Order` scoping (a block's `Order` must not leak to the directory, and the reverse).\n2. Only skip the denial when the block also holds `Allow from <clients>` or `Require ip|host|local`, without Order. Cheaper, but lists files `Order allow,deny` really denies."
acceptanceCriteria:
  - "A `<Files>` block with `Order deny,allow`, `Deny from all` and `Allow from <ip>` keeps the matched file as a route"
  - "A `<Files>` or `<FilesMatch>` block with `Require ip` beside `Require all denied` keeps the matched files as routes"
  - "A `<Files>` block with `Order allow,deny` and `Deny from all`, or with `Deny from all` alone, still drops the matched file"
  - "An `Order` inside a `<Files>` block does not change how the directory's own `Allow`/`Deny` lines are read"
  - "A unit test in packages/lang-php/tests/unit/php-docroot.test.ts covers each case above"
touches:
  - "461f9855-cb81-4dd4-a457-7d58841a7502"
priority: "medium"
discoveredFrom: {"item":"f2a302a2-bb06-40b9-831a-3916923e0ee7","run":"1a2a86cc-da57-4b75-9b52-88eb818c35a3"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-php"
  - "routes"
source: "ndx-adversarial-review"
---
