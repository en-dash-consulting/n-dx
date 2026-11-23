---
"@n-dx/sourcevision": patch
---

`sv analyze` no longer treats a project's own `ckeditor/` or `highcharts/` folder, or a comment naming a jQuery version, as copied-in third-party code, and logs each folder it marks.

Action needed: if a copied-in library folder carries neither its banner nor its entry file and now rejoins zones, add its glob (`"js/editor/**"`) to `sourcevision.thirdParty` or pass `--third-party`.

A folder named as a well-known library is marked only when a file under it carries that library's header, or the library's entry file (`ckeditor.js`, `tinymce.min.js`, `PHPExcel.php`, …) sits under it (or beside it, for PHPExcel, HTML Purifier and SimplePie). Version banners (jQuery, Highcharts, Prototype, script.aculo.us, Dojo) are matched only where the library prints them, so `// requires jQuery v1.7 or later` marks nothing.

`analyze` prints one `[third-party]` line per marked folder with the library, the reason (`directory+banner`, `directory+entry`, `header`, `config`, `flag`) and, for a built-in mark, the deny glob that undoes it.
