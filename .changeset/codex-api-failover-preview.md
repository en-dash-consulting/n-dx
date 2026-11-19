---
"@n-dx/web": patch
---

The dashboard's `Automatic failover` preview recognizes supported Codex API runs, even when the setting is off, and explains why Codex CLI cannot fail over.

Unsupported direct OpenAI models keep their validation explanation. The displayed chain follows the existing resolver and configured models; execution support and saved authentication settings are unchanged.
