---
"@n-dx/llm-client": patch
---

Add `listVendorModels` and `isChatModelId`.

`listVendorModels` asks Anthropic's Models API (Claude) or OpenAI's `/v1/models`
(Codex) for the models a key can use, with the key resolved as the rest of
llm-client does (config, then `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). It
never throws: it returns the models or a reason, and no reason contains the key.
Ids are filtered with `isModelCompatibleWithVendor` and the new `isChatModelId`,
which drops embedding, audio, image, moderation, realtime and transcription
models.
