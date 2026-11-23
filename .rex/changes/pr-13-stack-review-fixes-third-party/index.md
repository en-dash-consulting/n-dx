---
id: "21554731-0146-4337-8707-67268fbebad1"
type: "change"
title: "PR 13 stack-review fixes: third-party marks need evidence, mirror and header passes scale"
slug: "pr-13-stack-review-fixes-third-party"
summary: "A review found that the new check for copied-in libraries can mistake a project's own code for a library just because of a folder name or a comment, and that two of the new checks slow down on very large projects. This makes the library check need real evidence, shows what it marked, and keeps both checks fast."
intent: "Found by the stack review posted on #1088 (PR 13) on 2026-11-18, at head bcad009e2, probes run on the stack tip b8f3537e1. All three are in code PR 13 (change c105a2c0) added. A run on n-dx's own tree marked nothing, so this repository does not regress; the risk is in other TypeScript and JavaScript repositories, since these rules run for every repository, not only PHP estates.\n\n1. P3: `packages/sourcevision/src/analyzers/third-party.ts` `LIBRARY_DIRECTORIES` marks any folder named `ckeditor`, `tinymce`, `highcharts`, `yui` and so on, at any depth, as third-party. That includes an application's own integration code (`src/ckeditor/plugins/MyPlugin.ts`, a common CKEditor 5 layout; `src/charts/highcharts/options.ts`), which then silently leaves zones, classification and the call graph.\n2. P3: the jQuery banner `\\bjQuery v\\d+\\.\\d+` matches a comment such as `// requires jQuery v1.7 or later` in an application file's first 2 KB.\n3. P3: `packages/sourcevision/src/analyzers/mirrors.ts` scores each candidate root pair with `countUnder` and `matchedFiles`, each a full inventory scan, so the cost is O(candidate pairs × files), though the module note says linear. `markThirdParty` reads a 2 KB header from every inventoried file one at a time on every run (0.7 s on n-dx's 5.3k files).\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Fixtures are invented.\n\nLane rules: every code change goes through `ndx work`; targeted tests only, CI (`ci:run`) runs the suites. Patch changesets with scoped names."
acceptanceCriteria:
  - "A first-party folder named like a library, with no library banner or entry file, stays first-party"
  - "A comment mentioning a jQuery version does not mark a file as jQuery"
  - "analyze names each folder marked third-party and why"
  - "Mirror detection and the third-party header pass do not rescan the inventory per candidate pair or read headers serially"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"c105a2c0-92f5-4e2f-ad3f-9e6a913d75d3"}
tags:
  - "sourcevision"
  - "php-pr13"
  - "stack-review"
---
