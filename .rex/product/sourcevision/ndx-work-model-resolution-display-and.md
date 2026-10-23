---
id: "3d1dfc17-ba48-4fb7-8b2e-392593740605"
type: "capability"
title: "ndx work Model Resolution, Display, and Vendor-Change Reset"
slug: "ndx-work-model-resolution-display-and"
statement: "When the LLM vendor changes, n-dx detects a configured model that is not valid for the new vendor, and it resets that model and warns about it."
criteria: [{"id":"c1","text":"When the vendor is changed via ndx config and the current model value is not valid for the new vendor, ndx config shall clear or reset the model field."},{"id":"c2","text":"When a stale model value is detected and auto-cleared, ndx config shall emit a warning stating the old model value and the new resolved default."},{"id":"c3","text":"If .n-dx.json has been edited to change the vendor without updating the model, ndx work and ndx config shall emit a validation warning on their next run."},{"id":"c4","text":"While the vendor is unchanged, ndx config shall leave the model field as it is."}]
requirements: [{"id":"3d1dfc17-ba48-4fb7-8b2e-392593740605:c1","title":"When the vendor is changed via ndx config and the current model value is not valid for the new vendor, ndx config shall clear or reset the model field","description":"Linked to: packages/llm-client/tests/unit/vendor-model-reset.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When the vendor is changed via ndx config and the current model value is not valid for the new vendor, ndx config shall clear or reset the model field."]},{"id":"3d1dfc17-ba48-4fb7-8b2e-392593740605:c4","title":"While the vendor is unchanged, ndx config shall leave the model field as it is","description":"Linked to: packages/llm-client/tests/unit/vendor-model-reset.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["While the vendor is unchanged, ndx config shall leave the model field as it is."]}]
source: "smart-add"
priority: "high"
---

The ndx work command does not surface the LLM model configured in .n-dx.json to the user at run time, and may not propagate it to the underlying hench LLM call sites. Additionally, when the vendor is changed, a stale model value from the previous vendor can persist in config, causing silent misconfiguration.
