---
id: "033b28e3-de35-4ca0-9c1d-03de5055a335"
level: "task"
title: "Keep the TypeScript config when a markerless repo also has Terraform"
status: "pending"
priority: "critical"
tags:
  - "review-fixes"
  - "must-fix"
  - "lang-kit"
  - "pr-17"
source: "review"
acceptanceCriteria:
  - "A markerless repo with JS/TS files and a deep .tf file detects typescript as primary and terraform as secondary, keeping TS skip dirs and test/generated patterns"
  - "A markerless repo with no JS/TS files and only .tf evidence still detects terraform alone (pure-Terraform repos unchanged)"
  - "detectLanguage and detectLanguages agree; mixed-repo and Ruby+tf fixtures added; existing tests pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block the network and ~/.cache corpora. If it does, leave the corpus and byte-identity checks to the session, which verifies them; do not capture follow-ups for them."}
description: "Stack review must-fix (#767 line 418, widened by #768). A repo with no root package.json, go.mod, Python, Swift, C#, Maven or Gradle marker used to get [typescriptConfig]. Now any .tf file in it gives [terraformConfig] alone, because hasTerraformMarker walks at any depth since #768. mergeLanguageConfigs then uses that config alone. That covers Ruby, Rust, PHP and Elixir repos, which all take the TS fallback on main, and a polyglot repo with web/package.json and infra/*.tf.\n\nWhat breaks for such a repo:\n- TS's skip dirs are gone (dist, build, coverage, .next), leaving only terraformConfig's .terraform.\n- *.test.js and __tests__/ files lose their test role and become source.\n- TS config and generated patterns are gone, so src/types.d.ts becomes source.\n- manifest.language becomes terraform.\n\nThe review reproduced it with a deep deploy/envs/prod/eu/west/main.tf:\n\n```\nbefore: [\"typescript\"]  src/a.test.js:test    src/types.d.ts:generated  tests/app_test.rb:test\nafter:  [\"terraform\"]   src/a.test.js:source  src/types.d.ts:source     tests/app_test.rb:source  dist/bundle.js:source\n```\n\nCode: packages/lang-kit/src/detect.ts, the no-markers branch of detectLanguages (around line 362: `return [(await options.hasTerraformFile([typescriptConfig])) ? terraformConfig : typescriptConfig];`) and the matching shape in detectLanguage (around line 314). The Java branch just above already keeps both configs.\n\nFix: when the markerless repo has any JS/TS file, return [typescriptConfig, terraformConfig], with TS primary and Terraform secondary, and have detectLanguage keep TS primary. Return [terraformConfig] alone only when the repo has no JS/TS files, so a pure-Terraform repo (terraform-aws-rds in the corpus) stays byte-identical. Also fix the hasTerraformMarker docstring, which claims the skip set equals the one the inventory uses with the result.\n\nTests: a mixed fixture with JS/TS files, a test file, a .d.ts and a dist/ directory, plus a deep .tf. Assert TS stays primary, the roles above are kept, and terraform is still detected. Add a markerless non-TS fixture (a Ruby file plus a deep .tf) that keeps today's TS fallback. Keep the existing 'is primary when .tf files are the only evidence' test."
lastModified: "2026-10-17T02:03:34.333Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
