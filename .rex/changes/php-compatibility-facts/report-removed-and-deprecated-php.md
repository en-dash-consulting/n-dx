---
id: "9edf040a-d8df-47aa-9234-9fe19f4c5751"
type: "task"
title: "Report removed and deprecated PHP constructs per file and per repository"
slug: "report-removed-and-deprecated-php"
summary: "Flag each use of a PHP feature that later versions removed or deprecated, so porting effort per repository can be counted before the migration starts."
description: "In `@n-dx/lang-php`, report each use of a construct removed or deprecated in later PHP versions, per file with position, and counts per repository by rule and by the version that removed it, persisted to readiness as optional ecosystem facts. Every rule cites its php.net migration guide page (backward-incompatible changes / deprecated features) as provenance.\n\nRules include: `mysql_*` functions (removed 7.0); `ereg*`, `eregi*`, `split`, `spliti`, `sql_regcase` (7.0); `<%`, `<%=` and `<script language=\"php\">` tags (7.0); call-time pass-by-reference (5.4); `register_globals`/`magic_quotes`/`safe_mode` related functions such as `session_register`, `get_magic_quotes_gpc` (removal versions per the guides); `mcrypt_*` (7.2); `create_function` (deprecated 7.2, removed 8.0); `each()` (deprecated 7.2, removed 8.0); `$str{0}` curly offset (deprecated 7.4, removed 8.0); PHP 4 same-name constructors (deprecated 7.0, not constructors in 8.0); `(unset)` cast; `__autoload` (deprecated 7.2, removed 8.0); `${var}` string interpolation (deprecated 8.2); dynamic property creation on classes without `#[AllowDynamicProperties]` where statically visible (deprecated 8.2; report as a likely case only); `utf8_encode`/`utf8_decode` (deprecated 8.2); short open tags `<?` reported as a notice dependent on `short_open_tag` (never \"removed\"); the 8.0 string-to-number comparison change reported as a review notice where `==` compares a string literal to a number.\n\nRemoved constructs that tree-sitter-php cannot parse (old tags, `$s{0}`) are detected from ERROR nodes or text with their own rule, and the clean-parse report from the corpus PR should not double-count them.\n\n**Operator note:** the operator counts two corpus apps by hand for three rules (mysql_*, ereg*, each()) and logs both counts with append_log after the run."
acceptanceCriteria:
  - "Each listed removed or deprecated construct is reported per file with php.net provenance"
  - "Per-repository counts by rule and removal version appear in readiness as optional fields"
  - "Short open tags and the 8.0 comparison change are reported as notices, not removals"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "compatibility"
blockedBy:
  - "4d498f89-3213-4ad4-a8ff-ca343af7a626"
---
