---
id: "97c2e62a-3a6b-45b6-a279-e928ceb4827c"
type: "change"
title: "PHP 5 curly-brace string offsets ($s{0}) fail to parse, keeping the PHP 5 corpus under the 99.5% clean-parse bar"
slug: "php-5-curly-brace-string-offsets-s-0"
summary: "Old PHP code reads a character of a string as $s{0}. tree-sitter-php does not accept that form, so about 35 PHP 5 corpus files (WordPress 3.x, Zend Framework 1, phpBB, osCommerce) do not parse cleanly, and the PHP 5 rate is 99.48% against the 99.5% bar."
intent: "Measured by the operator on 2026-11-14 for PR 2 (task 220d4f19, logged there): PHP 5 repos 7066/7103 = 99.48%. About 35 of the 37 failing files use curly-brace string offsets (`$lucifer[0]{0}`, `$string{$i}`), legal in PHP 5, deprecated in 7.4 and removed in 8.0; tree-sitter-php 0.25.1 does not parse them. The other two are cakephp2's `class String` and codeigniter3 index.php:265. The client's PHP 5 repositories likely use the form too, and a parse error drops the facts around it.\\n\\nOptions: (1) before parsing, rewrite a curly offset that directly follows a variable, subscript or property into square brackets of the same length so positions stay put, in the PHP pack only, with a test per form; (2) report the form as a compatibility fact in PR 8 and accept the parse loss; (3) patch the grammar upstream. Decision for Ryan."
acceptanceCriteria:
  - "PHP 5 files using curly-brace string offsets parse with no ERROR node, or the decision to accept the loss is recorded"
  - "The PHP 5 corpus clean-parse rate is re-measured and logged"
priority: "medium"
source: "operator"
---
