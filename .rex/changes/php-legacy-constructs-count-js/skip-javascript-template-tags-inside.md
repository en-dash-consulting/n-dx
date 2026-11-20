---
id: "83cb1372-8369-49b3-893e-f4aad0c4dc8c"
type: "task"
title: "Skip JavaScript template <% %> tags inside script elements when counting ASP tags"
slug: "skip-javascript-template-tags-inside"
summary: "The PHP compatibility report counts JavaScript page templates that use <% %> as removed PHP tags, which overstates how much porting old apps need. This stops counting tags inside script elements."
description: "From the adversarial review of 9edf040a (run bb8c57cf), captured as Inbox change b0545263 (severity medium, should-fix). The `asp-tags` rule (packages/lang-php/src/php-legacy.ts, `ASP_TAG = /<%=?/g` over every `@legacy.inline-html` capture from queries/php-legacy/legacy.scm) counts every `<%` / `<%=` in a PHP file's inline HTML as a removed ASP tag. Underscore/EJS/Backbone JavaScript templates in inline HTML, e.g. `<script type=\"text/template\"><% _.each(items, function(i) { %><li><%= i %></li><% }); %></script>`, were never PHP (ASP tags only ran with `asp_tags` on, off by default), so the per-repository `removedIn[\"7.0\"]` count overstates porting work on Backbone-era PHP apps.\n\nChange (keeps the task's rule: ASP tags stay `removed` 7.0):\n- Do not report `<%` / `<%=` that sit inside an inline-HTML `<script>` element, whatever its `type` (text/template, text/html, text/x-*-template, or none), unless the element is `<script language=\"php\">` (already the `script-tags` rule). Track script open/close across the file's inline-HTML segments in order, since a template can span several segments split by `<?php ?>` blocks.\n- `<%` elsewhere in inline HTML stays `removed` 7.0 as today.\n- `<%` inside a PHP string literal is not inline HTML and must stay unreported (it is today; keep a test).\n- Document the treatment in docs/packages/sourcevision.md#php-pack-rules: ASP tags count only outside script elements, and the count assumes `asp_tags` could have been on.\n\nFixtures: a PHP file with a JS template in `<script type=\"text/template\">` (one segment), one where the template is split by a `<?php echo ... ?>` block, a real `<% %>` ASP tag outside any script, and a `'<% _.each(...) %>'` PHP string literal."
acceptanceCriteria:
  - "A <% %> JavaScript template inside a <script> element in a PHP file, in one inline-HTML segment or split by a PHP block, adds nothing to removedIn in the profile's ecosystem.php.legacyConstructs"
  - "A real <% %> tag outside any script element is still reported as removed 7.0, and a <% inside a PHP string literal is not reported"
  - "Fixtures cover all four cases in packages/lang-php/tests/integration/php-legacy.test.ts and the test fails on today's code"
  - "docs/packages/sourcevision.md#php-pack-rules documents the treatment"
priority: "medium"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
---
