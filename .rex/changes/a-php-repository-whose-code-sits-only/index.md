---
id: "17151a87-7746-47b2-964f-9f79344b6dcb"
type: "change"
title: "A PHP repository whose code sits only under a web-root subdirectory, with no composer.json, is analysed with the TypeScript config"
slug: "a-php-repository-whose-code-sits-only"
summary: "Older PHP sites often keep all their code in a folder such as htdocs or public_html and have no Composer file, so n-dx still treats them as TypeScript projects. Recognising them as PHP keeps their analysis honest."
intent: "Found by the adversarial review of 94b212f6 (php language config). Severity medium, verdict should-fix: it follows the spec's marker list but misses the capability criterion php-detect.\n\nScenario: a repository holds `htdocs/index.php`, `htdocs/lib/db.inc` and no root `composer.json` or `.php` file. `detectLanguage` (packages/lang-kit/src/detect.ts, the markerless branch after `hasJavaMarker`) finds no marker and returns `typescriptConfig`. The same repository with a few `.tf` files now becomes Terraform alone, because `.php` is no longer in `FALLBACK_LANGUAGE_EXTENSIONS` and `isFallbackSourceFile` stops counting it. Before this change it was TypeScript plus Terraform.\n\nReachable: `ndx analyze` on any such repository. phpConfig.entryPointPatterns already name `public/`, `web/` and `htdocs/` index.php.\n\nOptions:\n(a) Extend `hasRootPhpFile` to the docroot directories phpConfig names (`public/`, `web/`, `htdocs/`, plus `www/` and `public_html/`, which the PR 5 docroot rule also uses) holding an `index.php`. Cheap and keeps detection shallow. Recommended.\n(b) In the markerless branch, count source files (countSourceFiles already counts php) and pick PHP when PHP source outnumbers JS/TS. Broader, but changes detection for other markerless repositories.\nFor Terraform alone, count PHP as source that keeps a markerless repository from becoming Terraform alone, or let (a)/(b) decide before the Terraform check."
acceptanceCriteria:
  - "A repository with htdocs/index.php (or public_html/index.php) and no other marker is detected as php by detectLanguage and detectLanguages"
  - "A markerless repository with PHP files only below the root plus .tf files is not detected as Terraform alone"
  - "A TypeScript repository (package.json) with public/index.php keeps typescript as its primary language"
touches:
  - "956b7119-989e-41f1-ba0e-3e8d26494fee"
priority: "medium"
discoveredFrom: {"item":"94b212f6-fac0-4adb-8a12-814d38e792f9","run":"707f8067-b5a4-4a96-810f-a55acbf2c4a4"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-kit"
source: "ndx-adversarial-review"
---
