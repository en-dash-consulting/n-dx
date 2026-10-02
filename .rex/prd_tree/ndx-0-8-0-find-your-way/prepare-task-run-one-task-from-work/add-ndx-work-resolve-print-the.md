---
id: "3e07628e-0eac-4693-a434-40feeb34ac65"
level: "task"
title: "Add `ndx work --resolve`: print the resolved run settings, their sources and any refusals as JSON without running"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
  - "hench"
  - "core"
acceptanceCriteria:
  - "`ndx work --task=<id> --resolve .` prints only the JSON object described, and exits 0 even when it reports refusals."
  - "Each resolved field carries the source that supplied it; tests cover cli-flag, hench.models.<vendor>, llm.model, llm.<vendor>.model, llm.routes/tiers, vendor-default and autonomous-default."
  - "The resolved model equals what a real run with the same flags and config uses (a test runs both resolutions over a fixture matrix)."
  - "Every refusal code listed is reported as a refusal entry, not a throw, with a test per code."
  - "Resolve makes no writes and no spawns: no claim, PRD write, reset, git write, vendor CLI or LLM call (test asserts the tree, claims file and git status are unchanged)."
  - "`options` lists every per-run option the dashboard may send with its flag, type, allowed values and scope."
  - "Help text for hench run and ndx work documents --resolve; a patch changeset covers @n-dx/hench and @n-dx/core."
description: "The dashboard needs to show what a run would use before it starts, and must not re-derive it (web keeps a hand-maintained twin of hench's model chain in packages/web/src/server/effective-agent-config.ts that needs a contract test to stay correct). Add a resolve mode to `hench run`, reachable as `ndx work --task=<id> --resolve [flags] <dir>`, that runs the real flag parsing and config load in cmdRun (packages/hench/src/cli/commands/run.ts, cmdRun ~1507-2089) and stops before anything with side effects.\n\nOutput: one JSON object on stdout, nothing else:\n{ task: {id, title, status, level, blockedBy, claimedBy|null}, workspace: {root, branch, isAnchor?, dirty}, resolved: { vendor, model, provider, permissionMode, review, reviewModel, skipTestGate, maxTurns, tokenBudget, fresh, allowDirty, resetDeferred } — each as {value, source}, options: [ {key, flag, type: \"enum\"|\"boolean\"|\"integer\"|\"string\", values?, scope: \"task\"|\"launch\", description} ] — the per-run options the dashboard may send, refusals: [ {code, message} ], command: \"ndx work --task=<id> --auto … <dir>\" }.\n\nSources use the config key that supplied the value: `cli-flag`, `hench.models.<vendor>`, `llm.routes`, `llm.tiers.<vendor>.<tier>`, `llm.model`, `llm.<vendor>.model`, `vendor-default`, `hench.<key>` (e.g. hench.provider, hench.permissionMode, hench.maxTurns, hench.tokenBudget, hench.skipFullTestGate), `autonomous-default` (permissionMode acceptEdits under --auto), `built-in`. Extend resolveAgentModel (packages/hench/src/cli/commands/agent-model.ts) to return the rung, not just the model. Resolve as if --auto were passed (the dashboard always runs autonomous).\n\nRefusal codes to report rather than throw: task-not-found, not-actionable (completed/blocked/deferred without reset), claimed-elsewhere (read-only claims check, as --dry-run does at run.ts:1307), tree-not-conformant (slug rule; include whether migratable), vendor-unset, vendor-cli-missing, provider-unsupported, model-vendor-mismatch, dirty-tree (autonomous runs refuse without --allow-dirty). In-progress tasks are actionable (hench resumes them).\n\nNo side effects: no claim, no --reset-deferred write or commit, no PRD write, no vendor CLI spawn, no orientation session, no git write, no LLM call. packages/core/cli.js handleWork (2080-2114) currently exits on an unset vendor before spawning hench; with --resolve it must forward instead so hench reports `vendor-unset`, and skip printWorkIdentity and the Ctrl+C handler. Flags must be honoured exactly as a real run would (only the --flag=value form is forwarded by ndx work). `--resolve` without `--task` is an error. Document it in `hench run --help` (packages/hench/src/cli/help.ts) and `ndx work --help` (packages/core/help.js)."
lastModified: "2026-10-02T04:55:00.662Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
