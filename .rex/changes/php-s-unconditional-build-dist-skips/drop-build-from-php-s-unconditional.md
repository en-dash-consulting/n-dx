---
id: "cba3edbf-a5cf-4ca7-9504-6403b96500fb"
type: "task"
title: "Drop build from PHP's unconditional skip directories, keep dist"
slug: "drop-build-from-php-s-unconditional"
summary: "PHP projects now skip every folder named build, which hides copied-in libraries and other languages' code there. PHP should skip only built theme output under dist."
description: "Option 2 of this change, as recommended: give phpConfig its own skipDirectories, TYPESCRIPT_SKIP_DIRECTORIES without `build`, keeping `dist` and `node_modules` unconditional (packages/lang-kit; A6 made phpConfig reuse TYPESCRIPT_SKIP_DIRECTORIES in 079d37ff5). Do not change mergeLanguageConfigs or any non-PHP config.\\n\\nWhy now: CI fails on #1094 in Tests (rex+sourcevision) on all three OSes. packages/sourcevision/tests/e2e/cli-analyze-third-party.test.ts (from main, PR 13's third-party detection) expects an invented PHP app's copied-in YUI tree under js/build/ to be inventoried and marked third-party, and the app/main.js -> js/build/node/node.js import edge to resolve; with build skipped, line 63 gets 3 third-party marks instead of 7 and line 82 misses the edge.\\n\\nTests: in packages/lang-kit the language-registry and detect unit tests (A6's node_modules/dist cases must still pass; add the Python + PHP and Java + PHP merge cases this change's criteria name); from packages/sourcevision npx vitest run tests/e2e/cli-analyze-third-party.test.ts (needs pnpm build); pnpm --filter @n-dx/lang-kit exec tsc --noEmit. Update the A6 changeset (.changeset/php-skips-js-build-output.md) if it names build, keeping its lead within 30 words."
acceptanceCriteria:
  - "phpConfig skips node_modules and dist but not build"
  - "mergeLanguageConfigs([pythonConfig, phpConfig]) keeps a build/ directory holding __init__.py, and [javaConfig, phpConfig] keeps src/main/java/com/acme/build/"
  - "cli-analyze-third-party.test.ts passes"
  - "A6's PHP node_modules/dist tests still pass"
priority: "high"
---
