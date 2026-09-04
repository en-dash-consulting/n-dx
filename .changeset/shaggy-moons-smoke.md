---
"@n-dx/web": patch
---

SourceVision Ask: give each degraded mode a specific, actionable message.

The panel's failure card now names the mode it is in rather than reporting
"The Ask request failed (502)". Missing analysis offers the analyze/refresh
control itself instead of naming a command; credential failures render
`@n-dx/llm-client`'s canonical `authFailureGuidance` remediation, ending in
`VERIFY_CREDENTIALS_STEP`, sent from the endpoint as a new `remediation` field;
timeout, rate limit, and provider error are each reported as themselves, with a
retry offered for the two that are transient and the vendor's own retry delay
stated when it supplied one. The prompt survives every failure.

The endpoint also stops describing one failure while coding another: a typed
provider error whose message carries no classifiable text now takes its wording
from the kind it resolved to.
