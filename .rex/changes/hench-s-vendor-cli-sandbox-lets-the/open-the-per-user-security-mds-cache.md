---
id: "171c2786-68a5-45ce-9c93-6f1322b76121"
type: "task"
title: "Open the per-user Security MDS cache read-write to the vendor CLI on macOS"
slug: "open-the-per-user-security-mds-cache"
summary: "Let the sandboxed Claude CLI reach the one system cache its Keychain sign-in writes to, and nothing else."
description: "In createVendorCliSandbox (packages/hench/src/guard/sandbox.ts), on darwin only, resolve `getconf DARWIN_USER_CACHE_DIR`, join `mds`, take its real path (it lives under /private/var/folders/…/C/mds), and push it onto readWriteRoots. Resolve it once per sandbox with a short-timeout spawn through the existing spawn helpers (hench must not import node:child_process directly; check tests/e2e/architecture-policy.test.js), and skip silently when getconf fails or the folder does not exist. Extend the comment block above the Keychains read-only root to say why this folder needs write access (every SecItem/`security` lookup opens mds.lock and mdsDirectory.db read-write) and that only this folder is opened. Do not touch the tool sandbox (kind other than vendor-cli) or the profile builder in packages/llm-client/src/sandbox.ts beyond what a read-write root already produces."
acceptanceCriteria:
  - "On darwin the vendor-cli policy's readWriteRoots contain the real path of $(getconf DARWIN_USER_CACHE_DIR)mds and no other path under /private/var/folders"
  - "The tool sandbox policy is unchanged (a unit test asserts the mds path is absent from it)"
  - "When getconf fails or the folder is missing, the sandbox is built exactly as before"
  - "A macOS-only test (skipped elsewhere) runs `security find-generic-password -s <nonexistent>` or `claude auth status` inside the built vendor-cli profile and gets no Module Directory Service error"
  - "~/Library/Keychains stays read-only"
priority: "critical"
tags:
  - "hench"
  - "sandbox"
  - "macos"
source: "ndx-capture"
---
