---
id: "e08596a6-1754-42e7-bee1-c830ed9c3810"
type: "task"
title: "Mark a library folder third-party only with library evidence, anchor the jQuery banner, and log each mark"
slug: "mark-a-library-folder-third-party-only"
summary: "Stops a project's own code from being treated as a copied-in library because of its folder name or a comment, and shows in the run output what was marked and why."
description: "In `packages/sourcevision/src/analyzers/third-party.ts`:\n\n1. **Directory rule needs evidence.** Today a folder whose name is in `LIBRARY_DIRECTORIES` marks every file under it. Apply it only when the folder also holds the library's own evidence: a file whose header matches that library's `LIBRARY_BANNERS` entry, or the library's known entry file (for example `ckeditor.js`, `tinymce.min.js`, `tiny_mce.js`, `class.phpmailer.php`, `PHPExcel.php`, `adodb.inc.php`, `tcpdf.php`, `fpdf.php`, `edit_area_full.js`; add one entry file per library in a table beside `LIBRARY_DIRECTORIES`, each with its source). A library with no banner and no known entry file stays name-only only if it is a PHP-estate name with no plausible first-party use; say which in the table. Keep the vendor-directory rule, the header rule, the config globs and the CLI flags as they are.\n2. **Anchor the jQuery banner.** `\\bjQuery v\\d+\\.\\d+` matches `// requires jQuery v1.7 or later`. Match the real banner shapes only: `/*! jQuery v3.6.0 |`, `jQuery JavaScript Library v`, `jQuery UI - v`, i.e. at the start of a comment and with a full `\\d+\\.\\d+\\.\\d+` version. Check the other `LIBRARY_BANNERS` for the same looseness.\n3. **Log the marks.** analyze prints one line per marked folder (or per reason when files are scattered): the folder, the library and the reason (`directory+banner`, `directory+entry`, `header`, `vendor`, `config`, `flag`), so a wrong mark is noticed and can be undone with a deny glob. Name the deny syntax in the line or the docs.\n\nTests (invented fixtures): `src/ckeditor/plugins/MyPlugin.ts` and `src/charts/highcharts/options.ts` with no banner stay first-party; a copied `ckeditor/` holding `ckeditor.js` with its banner is third-party; an app file with `// requires jQuery v1.7 or later` stays first-party, a real `/*! jQuery v1.7.2 |` banner is marked; the log names each marked folder with its reason. Update `docs/packages/sourcevision.md` where it describes the folder rule.\n\nPatch changeset for `@n-dx/sourcevision`."
acceptanceCriteria:
  - "A first-party folder named like a library, with no banner or entry file, stays first-party"
  - "A real copied-in library folder is still marked"
  - "A comment naming a jQuery version marks nothing"
  - "analyze names each marked folder with its library and reason"
priority: "medium"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "sourcevision"
  - "php-pr13"
---
