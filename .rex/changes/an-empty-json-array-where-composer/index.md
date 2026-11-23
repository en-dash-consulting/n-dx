---
id: "dd6deb14-83e6-4220-8358-4f60a1764c76"
type: "change"
title: "An empty JSON array where Composer expects an object (`\"require\": []`) is reported as a wrong-type notice"
slug: "an-empty-json-array-where-composer"
summary: "PHP tools write an empty list where an empty map belongs, and Composer accepts it. n-dx flags these valid files with a false warning, which hides the real ones."
intent: "Verdict: should-fix (low), from the adversarial review of task a34d8b17.\n\nScenario: a composer.json with `\"require\": []`, `\"require-dev\": []`, `\"autoload\": []` or `\"psr-4\": []`, or a composer.lock package with `\"autoload\": []`. PHP's json_encode writes an empty array as `[]`, so generated manifests contain this, and Composer accepts it. The reader emits \"<file>: require is not an object\" (or similar) for each one. The data stays correct (empty), but notices that are true positives get buried.\n\nEvidence: packages/lang-kit/src/php-composer.ts fieldReader.object, used for require, require-dev, autoload, autoload-dev, config, psr-4 and psr-0, and for lock package autoload.\n\nReachability: readComposerProjects on such a manifest. Notices reach users once the PHP pack surfaces them.\n\nFix (recommended, cheap): in fieldReader.object, treat an empty array as an empty object without a notice. A non-empty array stays a notice."
acceptanceCriteria:
  - "A composer.json with \"require\": [] and \"autoload\": {\"psr-4\": []} yields no notices, covered by a unit test"
  - "A non-empty array where an object is expected still yields a notice"
touches:
  - "5e5d32b1-26ae-4594-a229-4b579038d053"
priority: "low"
discoveredFrom: {"item":"a34d8b17-2c8d-49d8-8c29-d5ac378cfd0c","run":"55fbcac8-eabf-46e7-b057-80e20b8da7e4"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-kit"
  - "composer"
source: "ndx-adversarial-review"
---
