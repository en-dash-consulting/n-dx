---
id: "2fc61616-fa58-4520-be7d-3f8d11a01473"
type: "task"
title: "Mark a file minified by content only when long lines fill its head, and log each one"
slug: "mark-a-file-minified-by-content-only"
summary: "Stops ordinary script and style files with one long embedded image or data line from being treated as compressed bundles and dropped from the map."
description: "`packages/sourcevision/src/analyzers/minified.ts` `hasMinifiedLine` marks a `.js`/`.mjs`/`.cjs`/`.css` file whose name does not say minified as role `generated` when any one line in its first 64 KiB is over 2,000 characters. This applies to every repository, not only PHP estates. A hand-written file holding an inline data URI, an embedded SVG or a JSON blob then drops out of `callgraph.json` and `components.json`; `--include-minified` brings it back only into the call graph.\n\nFix both:\n1. **Narrow the content rule.** A minified bundle is long almost everywhere, so require that lines over `MINIFIED_LINE_CHARS` hold most of the head (for example at least half of its characters; pick the share and say why in the constant's comment). A licence banner of short lines before one huge line is still minified. Keep the name rules unchanged. Update `MINIFIED_RULES` so cache fingerprints change with the rule.\n2. **Make it visible.** analyze prints one line counting files relabelled `generated` by content (not by name), naming up to the first few paths, so a wrong mark is noticed.\n\nTests (invented content): a 20 KB hand-written file with one 5 KB data-URI line keeps its role; a one-line 60 KB bundle with a 10-line licence banner is generated; a `.min.js` is generated whatever its content; the log line appears only when a file was relabelled by content. Output for repositories with no such files is unchanged.\n\nPatch changeset for `@n-dx/sourcevision`."
acceptanceCriteria:
  - "A hand-written JS or CSS file with one long line keeps its role"
  - "A real minified bundle, banner or not, is still role generated"
  - "analyze names the files relabelled by content"
  - "MINIFIED_RULES changes, so cached inventories are recomputed"
priority: "medium"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "sourcevision"
  - "php-pr12"
---
