---
id: "55f8ac69-075a-427f-b600-5b705496ff76"
type: "change"
title: "Codex client catalog offers custom-provider models that save validation rejects"
slug: "codex-client-catalog-offers-custom"
summary: "Keep model choices consistent with what the dashboard can save and run when Codex uses a custom provider."
intent: "Adversarial review: medium severity, should-fix. Introduced by account-aware model/list discovery. With the selected trusted Codex CLI configured for a provider/catalog returning model deployment-prod, packages/llm-client/src/codex-model-list.ts:78 accepts it and packages/web/src/server/routes-llm.ts:1127 exposes it in the picker. validateCatalogModel at routes-llm.ts:1090 rejects it before querying the same live catalog: Model \"deployment-prod\" is not a codex model. Reproduced using a disposable selected executable implementing initialize and model/list, invoking real getLiveVendorProbe and validateCatalogModel. Prior vendor-API listing filtered IDs by isModelCompatibleWithVendor, so it did not offer this unusable choice. No caller-side filter removes these entries from the live picker. Existing tests use only gpt-prefixed IDs. Edge path: custom providers; standard OpenAI IDs work, so this can wait for follow-up. Recommended small fix: apply the existing supported-model policy at the picker catalog boundary, with an actionable unsupported-provider explanation if all entries are excluded. Alternative: allow client-catalog-observed provider IDs consistently through config, saved-run and hench validation; this is a larger compatibility-policy change and should not be made implicitly. Add protocol-to-validation coverage for non-OpenAI-prefix model IDs. Checked related model/catalog/config changes and Inbox; none tracks this defect."
acceptanceCriteria:
  - "A Codex model/list response containing deployment-prod never offers it as a selectable model while the same dashboard rejects it as not a codex model; either consistently support it or explicitly exclude it with an explanation."
  - "A regression test carries a non-OpenAI-prefix client-catalog model through discovery, picker output and saved-run validation and asserts that these surfaces agree."
touches:
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
