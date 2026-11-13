---
id: "ee362e79-c9e5-429e-ab08-97e37d1e8385"
type: "change"
title: "The dashboard offers four project languages where n-dx supports seven"
slug: "the-dashboard-offers-four-project"
summary: "Settings › Project lets you pick only TypeScript, JavaScript or Go as the project language, and the dashboard refuses anything else. n-dx itself also supports Swift, Python, C# and Java, so those projects cannot set their language from the dashboard."
intent: "Found by the adversarial review of the Project settings redesign (#1040), and recorded there as an open question.\n\nThe canonical list is VALID_LANGUAGE_IDS in @n-dx/lang-kit (packages/lang-kit/src/detect.ts): typescript, javascript, go, swift, python, csharp, java, auto. Every id resolves through getLanguageConfig, and sourcevision honours the override (packages/sourcevision/src/language/detect.ts readConfigOverride). `ndx config language <id>` (packages/core/config.js VALID_LANGUAGES) already accepts the full list, held to it by tests/unit/config-language-parity.test.js.\n\nThe dashboard hard-codes a shorter list twice: VALID_LANGUAGES in packages/web/src/server/routes-project-settings.ts (PUT refuses swift, python, csharp and java with a 400) and LANGUAGE_OPTIONS in packages/web/src/viewer/views/project-settings.ts (the select offers Auto-detect, TypeScript, JavaScript, Go). A project already set to python through ndx config shows a select with no matching option.\n\nFix (recommended): one shared list of { id, label } in packages/web/src/shared/ used by both the route and the viewer, held to VALID_LANGUAGE_IDS by the existing parity test. Rejected: re-exporting VALID_LANGUAGE_IDS through sourcevision public and the web domain gateway (a public-surface and gateway-ceiling change for a constant), and serving the list from GET /api/project-settings (labels would still live in the viewer)."
acceptanceCriteria:
  - "Settings › Project offers Auto-detect, TypeScript, JavaScript, Go, Swift, Python, C# and Java, and saving any of them succeeds"
  - "PUT /api/project-settings accepts exactly the ids in @n-dx/lang-kit VALID_LANGUAGE_IDS, and refuses anything else with a 400 naming the valid values"
  - "A test fails when the dashboard list and VALID_LANGUAGE_IDS differ"
  - "A patch changeset for @n-dx/web"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "low"
source: "ndx-capture"
---
