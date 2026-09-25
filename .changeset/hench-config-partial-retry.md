---
"@n-dx/hench": patch
"@n-dx/web": patch
---

An invalid `.hench/config.json` no longer bricks `ndx work`, and the dashboard can no longer write one.

- hench's schema now fills a partial `retry` group with per-field defaults (sourced from `DEFAULT_RETRY_CONFIG`), so a config carrying only `retry.maxRetries` loads instead of failing with `NDX_CLI_INVALID_CONFIGURATION`.
- `hench run` loads config leniently: an invalid top-level setting is replaced with its default and reported as a warning naming it, instead of refusing the whole run. Salvage works per top-level key, so one bad field inside a group (say `retry.maxDelayMs`) resets that whole group (`retry`). A file that is not valid JSON still fails as before; a document that fails validation and cannot be salvaged (a non-object document, for example) now names the offending fields instead of a generic "corrupted" message.
- Every dashboard write path (`PUT /api/hench/config`, adaptive apply/override, workflow suggestion apply, template apply) completes a partially-written nested group from `CONFIG_GROUP_DEFAULTS` before serializing, so a single `retry.*` edit can never leave a one-member group on disk. The mirror between web's group defaults and hench's config defaults is pinned by `tests/e2e/hench-config-gate-contract.test.js`.
