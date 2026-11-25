---
id: "8507899d-67e7-4621-bc67-4c673b76edaa"
type: "task"
title: "Resolve the MDS cache path inside llm-client and drop execFileSyncNoShell from the hench gateway"
slug: "resolve-the-mds-cache-path-inside-llm"
summary: "Move the one system lookup the sandbox fix needs into the shared client library, and put hench's import count back."
description: "Add a small llm-client function next to the sandbox code (packages/llm-client/src/sandbox.ts), for example `darwinUserSecurityCacheDir()`, that returns the real path of `$(getconf DARWIN_USER_CACHE_DIR)mds` or undefined (non-darwin, getconf failure, missing folder). Preferred: the vendor-cli policy or profile builder in llm-client adds that folder itself for kind \"vendor-cli\" on darwin, so hench passes nothing new and needs no new export. If hench must still call it, export that one function through packages/hench/src/prd/llm-gateway.ts in place of execFileSyncNoShell so the count stays 250. Remove execFileSyncNoShell from the hench gateway (keep it in llm-client's public.ts only if something else uses it). Revert tests/e2e/architecture-policy.test.js for the hench llm-gateway to maxExports 250 with its previous description, and make docs/architecture/gateways.md match the inventory. Keep every behaviour and test from 0a0505fb9: the folder is read-write only for the vendor CLI, never for the tool sandbox, and skipped when getconf fails. hench must not import node:child_process. Run the six static root policy tests (tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy). Patch changeset for @n-dx/llm-client and @n-dx/hench if behaviour moves."
acceptanceCriteria:
  - "architecture-policy holds the hench llm-gateway at maxExports 250 with its previous description"
  - "packages/hench/src/prd/llm-gateway.ts does not export execFileSyncNoShell"
  - "On darwin the vendor-cli sandbox still has the MDS cache folder read-write and the tool sandbox does not"
  - "The sandbox tests from 0a0505fb9 pass, moved with the code if needed"
  - "docs/architecture/gateways.md matches the export inventory and the six static root policy tests pass"
priority: "high"
tags:
  - "hench"
  - "llm-client"
  - "gateway"
source: "operator review"
---
