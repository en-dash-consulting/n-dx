---
id: "012dc4ce-ed01-4ba6-81dc-6782d9c0ae61"
level: "feature"
title: "Google API Key Format Validation Bug Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-06-05T18:36:15.520Z"
completedAt: "2026-06-05T18:36:15.520Z"
endedAt: "2026-06-05T18:36:15.520Z"
acceptanceCriteria: []
description: "Newly generated Google AI API keys are rejected by the ndx validation layer with 'Invalid API key format. Google AI keys start with AIza and are at least 30 characters.' even when the key is valid. The validation regex or length check is either too strict, mismatched to actual key format, or applied at the wrong point in the config flow. This feature covers diagnosing the root cause, fixing the validation logic, and adding regression coverage to prevent recurrence."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests for Google API key validation across config and init paths](./add-regression-tests-for-google-315102.md) | completed |
| [Diagnose and fix Google API key format validation rejecting valid keys](./diagnose-and-fix-google-api-key-edd062.md) | completed |
