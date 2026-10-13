---
"@n-dx/hench": patch
---

A Codex or Gemini project with `llm.effort` set no longer warns on every run
that its model "does not accept an effort setting".

`llm.effort` is a Claude setting. Resolving it for a CLI spawn ran the
allowlist check whatever the vendor, and that check does more than drop the
value — it warns, which reads as a misconfiguration. Before hench's CLI loop
resolved effort at all, nothing was sent and nothing was printed. A non-Claude
model now returns before the check. A *Claude* model that cannot take effort
still warns, which is the case the warning is for.
