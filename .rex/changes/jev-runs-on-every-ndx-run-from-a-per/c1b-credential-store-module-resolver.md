---
id: "2f5ce643-1c49-4c70-ab2c-545f956873df"
type: "task"
title: "C1b: credential store module, resolver and file backend in llm-client"
slug: "c1b-credential-store-module-resolver"
description: "PR 1. One module, packages/llm-client/src/credential-store.ts, owns the store format, read, write, lock and owner-only permissions (shape B in 02-reground). Store is <resolveNdxHome()>/credentials.json, shared by every project and worktree. Env var first, then the store. Port core/file-permissions.js restrictFileToOwner's win32 icacls path into llm-client for the writer (llm-client's other per-user files only chmod today). Add a spawnable entry (src/cli/credentials.ts -> dist/cli/credentials.js) that core/config.js will spawn with the value on stdin. Vendor keys are NOT read from the store in this PR. The shape must allow C1 Connections later without a format change: library writer, open entry names (connection:<id>), unknown fields preserved, cross-process lock. Never print or log a credential value; tests use placeholders in a temp ndx home."
acceptanceCriteria:
  - "credential-store.ts exports credentialStorePath, resolveCredential(name, {env, ndxHome}) -> {value, source: env|file} | undefined, setCredential, unsetCredential and credentialStatus (name, backend, source, 8-char SHA-256 fingerprint, never the value), all re-exported from public.ts"
  - "A non-blank TYPESAFE_API_KEY returns source env even when the store holds a different value (unit test)"
  - "File format is {version: 1, entries: {<name>: {backend: file, value, updatedAt}}}; names match ^[a-z0-9][a-z0-9._:-]*$; unknown top-level and entry fields survive a write; an unknown version is never overwritten and reads as undefined with one warning (unit tests)"
  - "Writes are atomic (temp file in the same dir, then rename) under a cross-process lock; a two-writer test loses no update"
  - "On POSIX the file ends 0600 and its directory 0700 (test stats both); on win32 the writer calls an owner-only ACL helper ported from restrictFileToOwner, unit-tested with injected exec asserting the icacls arguments"
  - "On POSIX a group- or world-readable store is refused with a warning naming the fix; reads are cached per process by mtime and a rewrite is seen without restart (unit tests)"
  - "dist/cli/credentials.js supports set <name> (value from stdin only), unset <name> and status [--json]; it refuses a value on argv, never prints a value, and accepts only typesafe in this PR"
  - "resolveApiKey and resolveVendorCliEnv are unchanged: no vendor key is read from the store"
  - "Any new export re-exported through hench's llm-gateway is listed in tests/integration/cross-package-contracts.test.js with its architecture-policy ceiling raised and a reason"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "250e6c57-54a5-4d31-815c-720ea268e972"
---
