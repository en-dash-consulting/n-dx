---
id: "6af46475-e55a-465d-8d91-f0e91136ab1b"
type: "task"
title: "Detect PHP sites whose code sits only under a docroot folder"
slug: "detect-php-sites-whose-code-sits-only"
summary: "Old PHP sites often keep every file in a folder like htdocs or public_html with no Composer file, and n-dx still treats them as TypeScript. This makes them count as PHP."
description: "In-scope should-fix from the adversarial review of 94b212f6 (run 707f8067), captured as Inbox change 17151a87-7746-47b2-964f-9f79344b6dcb. Read that change's intent: it has the scenario and options.\n\nLegacy PHP sites (the client's PHP 5 repositories among them) often keep all code under a docroot folder with no composer.json and no .php at the root. Today `detectLanguage` (packages/lang-kit/src/detect.ts, the markerless branch) returns typescriptConfig for them, and the same repository with a few .tf files becomes Terraform alone, because .php left FALLBACK_LANGUAGE_EXTENSIONS.\n\nDo option (a): extend the root-PHP check (`hasRootPhpFile` or its equivalent) so an `index.php` in one of the docroot directories `public/`, `web/`, `htdocs/`, `www/`, `public_html/` counts as the same weak PHP marker a root .php file is. A stronger marker of another language (package.json, pyproject.toml, go.mod, pom.xml, and the rest) still wins. Keep detection shallow: no recursive walk. Also make a markerless repository whose PHP sits below the root plus .tf files not become Terraform alone (PHP is detected, or at least it keeps its pre-change TypeScript+Terraform result; prefer PHP+Terraform if the weak marker applies).\n\nAnalyze output for every non-PHP repository stays byte-identical. Tests in packages/lang-kit/tests/unit/detect.test.ts (and sourcevision's detect test if it enumerates cases). Add a patch changeset line only if the existing .changeset/php-language-config.md does not already cover @n-dx/lang-kit (it does: extend it rather than adding a file). Before finishing, run the six static root policy tests named in the change intent."
acceptanceCriteria:
  - "A repository with htdocs/index.php (or public_html/index.php) and no other marker is detected as php by detectLanguage and detectLanguages"
  - "A markerless repository with PHP files only below the root plus .tf files is not detected as Terraform alone"
  - "A TypeScript repository (package.json) with public/index.php keeps typescript as its primary language"
  - "Analyze output for every existing non-PHP fixture is byte-identical"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-kit"
---
