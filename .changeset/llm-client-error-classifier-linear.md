---
"@n-dx/llm-client": patch
---

The LLM error classifier no longer takes cubic time deciding whether a long provider error body is an authentication failure, and `parseLmStudioError` no longer takes cubic time on a long LM Studio body that repeats "model not". The auth signatures read the first 4 KB of the message and allow at most 80 characters between the words of a phrase; the model-not-loaded signature allows 200. A JSON body longer than the window still yields its `error.message`. Results are otherwise unchanged.
