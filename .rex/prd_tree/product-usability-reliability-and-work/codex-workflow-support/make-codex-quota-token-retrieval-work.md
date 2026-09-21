---
id: "676ea223-6ad6-410e-b484-873baff2feee"
level: "subtask"
title: "Make Codex quota/token retrieval work for codex login (session auth) users"
status: "completed"
priority: "high"
startedAt: "2026-07-08T16:07:31.246Z"
completedAt: "2026-07-08T16:36:00.930Z"
endedAt: "2026-07-08T16:36:00.930Z"
description: "quota/index.ts:114, codex-quota.ts:177/193/218, and codex-token-retrieval.ts:241/268/291 all require OPENAI_API_KEY and hit legacy OpenAI dashboard billing endpoints, then filter usage by exact model-id match. This contradicts the primary Codex CLI auth path (codex login / ChatGPT session) — codex-cli-provider.ts even deletes OPENAI_API_KEY so session auth wins. Result: quota is silently skipped (auth) or returns not-found for real accounts. Either support session-auth quota retrieval or surface a clear 'quota unavailable for codex login' message instead of silent skip. Fix exact model-id match to handle dated deployment ids."
---
