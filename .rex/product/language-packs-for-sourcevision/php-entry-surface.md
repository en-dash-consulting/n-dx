---
id: "461f9855-cb81-4dd4-a457-7d58841a7502"
type: "capability"
title: "PHP entry surface"
slug: "php-entry-surface"
statement: "Sourcevision lists a PHP application's entry points: each reachable file under its document roots as a URL route, .htaccess front-controller routes, and CLI and cron scripts."
criteria: [{"id":"php-routes","text":"Docroot files and .htaccess front controllers appear as server routes with their handler files"},{"id":"php-cli-entries","text":"CLI and cron PHP scripts are marked as entry points"}]
---

## History

- 2026-11-16 238cd947-069f-4b9f-980c-9c800c2cafae added: PHP entry surface: docroot URLs, .htaccess and CLI entries
