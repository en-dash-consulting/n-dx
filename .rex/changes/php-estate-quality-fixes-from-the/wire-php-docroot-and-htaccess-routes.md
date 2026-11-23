---
id: "0b1480cf-c292-438f-b804-1689d3f31255"
type: "task"
title: "Wire PHP docroot and .htaccess routes into components.json"
slug: "wire-php-docroot-and-htaccess-routes"
summary: "Make the PHP pages and front-controller routes the pack already finds show up in the analysis output, so a legacy site's list of entry pages is visible."
description: "**Problem (real deep run).** `components.json` was empty for PHP: no serverRoutes and no routeModules. No output file had any docroot or `.htaccess` facts, although PR 5 (#1059, task `3a05f5ae`) added the PHP entry surface.\n\n**Fix.**\n- Find where the PHP route facts get lost between the pack and `components.json`. Candidates: the framework-facts path; the route phase running only for JS/TS or for framework packs; a filter on file role; and docroot detection failing on a layout with several docroots, or with no `public/` but `index.php` in a subfolder.\n- Wire them through the same path the Python and Spring routes use.\n- Add an end-to-end test (CLI analyze `--fast` on an invented legacy fixture with a docroot, a denied `admin/` and an `.htaccess` front controller) asserting `components.json` serverRoutes holds them.\n- Also log one line with the route count per docroot.\n\n**Operator note:** if the cause is that docroot detection doesn't recognise the real layout's shape, describe the shape in the task log and fix detection with an invented fixture of that shape. Never use real paths."
acceptanceCriteria:
  - "An analyze --fast of a PHP repository with a docroot and an .htaccess front controller writes its routes to components.json serverRoutes"
  - "The cause of the missing routes is named in the task log and covered by an end-to-end test"
  - "Analyze logs the route count per detected docroot"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "lang-php"
  - "sourcevision"
  - "routes"
blockedBy:
  - "6157500a-21ac-43e6-8f18-723ba4e88ec0"
---
