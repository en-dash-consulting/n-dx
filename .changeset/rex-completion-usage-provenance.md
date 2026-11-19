---
"@n-dx/rex": patch
"@n-dx/web": patch
---

`n-dx usage`, `n-dx status`, and the LLM Utilization dashboard distinguish missing Rex usage measurements from measured zero and label incomplete cost totals.

Unavailable, malformed, and partial completion diagnostics survive package, model, command, and time-period reporting. Successful diagnostics annotate command-owned totals without adding calls or tokens; failed calls remain counted once. Recorded spend, including cache tokens, is retained in mixed records.

Cost reports expose measurement completeness separately from model-price attribution. Their formatted totals identify unknown usage or recorded subtotals, while numeric cost fields continue to represent recorded tokens. Legacy logs keep their existing interpretation; no historical data or pricing policy changes.
