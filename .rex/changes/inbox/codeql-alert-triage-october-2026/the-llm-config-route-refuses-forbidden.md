---
id: "244a15f7-aa19-469a-870b-f250e48063ac"
type: "task"
title: "The LLM config route refuses forbidden path segments on set and delete"
slug: "the-llm-config-route-refuses-forbidden"
description: "Layer 2 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 2). CodeQL alerts 59 and 58 (js/prototype-pollution-utility), with tests for the dismissed 57 and 60. In packages/web/src/server/routes-llm.ts the flagged setByPath is safe, but its sibling deleteByPath is reachable: validateLlmChange skips validateRoutingChange for a null or empty value, validateModelForVendor's vendor regex does not match __proto__, and isWritablePath accepts any llm.tiers.* path, so PUT /api/llm/config with changes {llm.tiers.__proto__.toString: null} deletes Object.prototype.toString in the dashboard process (also via POST .../preview). Fix: reject FORBIDDEN_CONFIG_SEGMENTS at the top of validateLlmChange, apply the llm.tiers.<vendor>.<tier> shape check to deletes, and guard inside setByPath and deleteByPath. routes-features.ts: replace the private setByPath/getByPath with the guarded setConfigValue/getConfigValue from hench-config-fields.ts. routes-workflow.ts line 506: Object.hasOwn on the APPLYABLE_SUGGESTION_KEYS lookup so a toString body key is not accepted. Add a direct setConfigValue poison-path test. Branch fix/web-llm-config-proto-pollution."
acceptanceCriteria:
  - "PUT and preview with llm.tiers.__proto__.toString set to null or an empty string answer 400, Object.prototype.toString is intact and .n-dx.json is unchanged"
  - "PUT with llm.routes.__proto__ answers 400 instead of a 200 no-op"
  - "A feature-gates PUT with a __proto__.polluted key answers 400"
  - "setConfigValue rejects __proto__, constructor and prototype segments directly, and a workflow apply body keyed toString writes nothing"
  - "Patch changeset for @n-dx/web"
priority: "high"
source: "codeql-triage"
---
