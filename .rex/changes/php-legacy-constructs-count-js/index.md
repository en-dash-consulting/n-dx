---
id: "b0545263-34bc-40dc-bb81-04cb046e02ed"
type: "change"
title: "PHP legacy constructs count JS template <% %> tags in inline HTML as removed ASP tags"
slug: "php-legacy-constructs-count-js"
summary: "The PHP compatibility report counts every <% … %> in a page's HTML as a removed ASP tag, including JavaScript templates that were never PHP, which inflates the porting effort counted for older apps."
intent: "Verdict: should-fix (ndx-adversarial-review of task 9edf040a, run bb8c57cf). Severity medium.\n\nScenario: a PHP view holding an Underscore/EJS template in inline HTML, e.g. `<script type=\"text/template\"><% _.each(items, function(i) { %><li><%= i %></li><% }); %></script>`, gets three `asp-tags` facts with status `removed` (7.0), and sdlc-profile.json's `ecosystem.php.legacyConstructs.removedIn[\"7.0\"]` grows by three. ASP tags were PHP only while `asp_tags` was on (off by default), so this markup never ran as PHP. Backbone/Underscore-era PHP apps carry such templates, so the per-repository removal count overstates porting work on a real path (`sv analyze` with the PHP pack).\n\nEvidence: packages/lang-php/src/php-legacy.ts `ASP_TAG = /<%=?/g` applied to every `@legacy.inline-html` capture (queries/php-legacy/legacy.scm `(text) @legacy.inline-html` with a `<%` predicate). Reproduced with a probe on the built pack: asp-tags@1:35, @1:72, @1:85.\n\nOptions:\n1. Report ASP tags as a `notice` dependent on `asp_tags`, like `short-open-tag` (cheap; changes the task's literal spec \"removed 7.0\", so it is the owner's call). Recommended.\n2. Keep `removed` but skip `<%` inside `<script type=\"text/template\">`/`text/x-*-template` blocks and mark the rest `likely` (more code; still misses templates elsewhere).\n3. Read `asp_tags` from php.ini/.htaccess/.user.ini via the resolver's configFiles and count removals only when it is on (most accurate; most work)."
acceptanceCriteria:
  - "A `<% … %>` JavaScript template inside `<script type=\"text/template\">` in a PHP file adds nothing to `removedIn` in the profile's `ecosystem.php.legacyConstructs`"
  - "A fixture with a JS template in inline HTML is covered by a test in packages/lang-php/tests/integration/php-legacy.test.ts that fails on today's code"
  - "The chosen treatment of ASP tags (notice, likely, or asp_tags-aware) is documented in docs/packages/sourcevision.md#php-pack-rules"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"9edf040a-d8df-47aa-9234-9fe19f4c5751","run":"bb8c57cf-353d-43e5-9720-05b94c0de0f5"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-php"
  - "compatibility"
source: "ndx-adversarial-review"
---
