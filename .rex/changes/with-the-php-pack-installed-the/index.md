---
id: "c479ce14-6923-4eb1-a463-e631f3f80817"
type: "change"
title: "With the PHP pack installed, the dashboard lists PHP as analysed although no PHP import edges exist"
slug: "with-the-php-pack-installed-the"
summary: "With the PHP pack installed, the dashboard says PHP files take part in import and zone analysis before any PHP imports are linked to files. The label should only appear once that linking works."
intent: "Verdict: should-fix (medium). Found by the adversarial review of task 5cd796e9 (PHP structure queries).\n\nScenario: a PHP repository with @n-dx/lang-php installed and its grammar built. The pack now produces \"imports\" (FileReferences.written only; phpResolver in packages/lang-php/src/php-imports.ts returns files: [] and external: []). buildPackImportGraph (packages/sourcevision/src/analyzers/pack-imports.ts:193) calls options.analysed(\"php\"), so withPackAnalysedLanguages adds PHP to inventory.summary.analysedLanguages. The dashboard's language strip (packages/web/src/viewer/components/language-analysis-strip.ts) shows PHP under \"Analysed\", which it defines as \"languages whose files take part in import-graph and zone analysis\". No PHP file has an edge, so that is a wrong statement.\n\nReachable: only with the opt-in pack installed and built. The pack is not published yet (new npm name), and the PHP stack's PR 3 and PR 4 (resolve-php-namespaces-through-composer, resolve-legacy-php-includes) add the edges that make the label true. Covered: tests/integration/php-pack-imports.test.ts currently asserts analysed = [\"php\"], which pins the current behaviour.\n\nOptions:\n1. (Recommended if PR 3 is not landing in the same release) Let sourcevision count a pack as analysed only when its entry resolves imports: e.g. an optional `resolves: false` on LanguagePackEntry, or skipping analysed() when a pack returns no files/external for every file. Cost: small contract addition plus a test. Risk: a resolver that genuinely finds no edges in a tiny project would drop out of analysedLanguages, so the explicit flag is safer than inferring.\n2. Accept the label until PR 3 lands, and make PR 3's acceptance criteria include it. Cost: none now. Risk: if this PR ships alone, PHP users see a false \"Analysed\" label.\nDecision for the operator: whether PR 2 can ship to npm without PR 3."
acceptanceCriteria:
  - "With the PHP pack running but resolving no import into a file or package, inventory.summary.analysedLanguages does not list PHP (php-pack-imports.test.ts asserts analysed is empty or the summary is unchanged)"
  - "Once a PHP resolver yields edges, PHP is listed as analysed again, covered by a test"
touches:
  - "5e5d32b1-26ae-4594-a229-4b579038d053"
priority: "medium"
discoveredFrom: {"item":"5cd796e9-6177-4d40-8439-b1678e700322","run":"27d70059-da72-4a36-a19c-19449c1a9513"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
