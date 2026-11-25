---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

On macOS, `ndx work` runs the Claude CLI inside its sandbox without failing with "Not logged in": the CLI can read its keychain login again.

Every keychain lookup opens the Security framework's per-user MDS cache, `$(getconf DARWIN_USER_CACHE_DIR)mds`, read-write. The vendor-cli sandbox left it read-only, so the lookup failed with "A Module Directory Service error has occurred". That one folder is now writable to the Claude CLI only; the tool sandbox, the rest of `/private/var/folders` and `~/Library/Keychains` (still read-only) are unchanged. When `getconf` fails or the folder is missing, the sandbox is built as before.

`@n-dx/llm-client` exports `execFileSyncNoShell` for this lookup.
