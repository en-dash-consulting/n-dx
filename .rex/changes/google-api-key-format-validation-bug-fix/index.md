---
id: "012dc4ce-ed01-4ba6-81dc-6782d9c0ae61"
type: "change"
title: "Google API Key Format Validation Bug Fix"
slug: "google-api-key-format-validation-bug-fix"
intent: "Newly generated Google AI API keys are rejected by the ndx validation layer with 'Invalid API key format. Google AI keys start with AIza and are at least 30 characters.' even when the key is valid. The validation regex or length check is either too strict, mismatched to actual key format, or applied at the wrong point in the config flow. This feature covers diagnosing the root cause, fixing the validation logic, and adding regression coverage to prevent recurrence."
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
source: "smart-add"
---
