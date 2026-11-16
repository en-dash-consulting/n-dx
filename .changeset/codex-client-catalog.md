---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

The dashboard discovers Codex models through the configured CLI without requiring an API key for ChatGPT login.

Codex model lists identify their client-catalog provenance, CLI version and check time; they do not prove inference access. Failed or unsupported probes retain the built-in list with an actionable reason. Account and binary changes are rechecked on each lookup. OpenAI API catalog membership no longer determines the dashboard's live Codex choices.

Unaccepted checkouts retain a fallback until `n-dx trust accept .`. Existing explicit model pins remain unchanged.
