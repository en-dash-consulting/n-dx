---
"@n-dx/llm-client": patch
---

Add the per-user credential store, `<ndx home>/credentials.json`:
`resolveCredential` (environment first, then the store), `setCredential`,
`unsetCredential` and `credentialStatus`. Writes are atomic, lock against
other processes, and leave the file owner-only (0600, or an owner-only ACL on
Windows). The spawnable `dist/cli/credentials.js` stores a value read from
stdin and never prints one. Vendor keys are not read from the store yet.
