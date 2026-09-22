---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
---

Sourcevision can send file archetype classification (`code.classify`) to TypeSafe's Jev, a System One model that answers a Choice over the archetype catalog with a probability per option instead of free-text JSON. Setting `TYPESAFE_API_KEY` opts in; `llm.routes["code.classify"] = "light"` sends the class back to the vendor tier, and `llm.routes["<class>"] = "typesafe"` names the route explicitly. Classifications made this way carry Jev's probability as their confidence rather than a fixed 0.7, and a sub-threshold or `none` answer leaves the file unclassified. Without the key nothing changes. `@n-dx/llm-client` gains `resolveJudgmentRoute` and `DEFAULT_JUDGMENT_ROUTES`; `LLM_VENDOR` and `ClaudeClient.complete` are untouched.
