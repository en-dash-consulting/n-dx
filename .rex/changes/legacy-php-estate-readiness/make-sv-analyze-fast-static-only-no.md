---
id: "7bb107a8-6831-44c8-9dc8-4a1cc51ffa70"
type: "task"
title: "Make sv analyze --fast static-only: no judgment calls and no command log"
slug: "make-sv-analyze-fast-static-only-no"
summary: "Stop the quick analysis mode from contacting any AI service or leaving a command log in the scanned repository, so a client codebase can be scanned with nothing sent off the machine."
description: "**Problem.** `sv analyze --fast` is documented as \"skip AI enrichment\", and the batch scan relies on it being static-only. Two things break that:\n\n1. **Jev judgment calls are not gated by `--fast`.** In `packages/sourcevision/src/analyzers/zones.ts` (the \"Move judgment\", \"Judgment step\" and \"Heuristic judgment\" blocks after enrichment), `judgeMoves`, `judgeFindings`, `judgeZoneFragility` and `judgeHeuristicFindings` (`analyzers/enrich-judge.ts`) run whenever `getJudgmentRoute()` resolves, which happens whenever a TypeSafe key exists (`TYPESAFE_API_KEY` in the environment, or the per-user credential store). Measured on an invented probe with only the env var set: `sv analyze --fast` sent 3 POSTs to the Jev endpoint, carrying finding text and code evidence. Check every other judgment route too (`code.classify` in `analyzers/classify.ts`, `partition-review.ts`, `rerun-judge.ts`, `typed-findings.ts`, `area-naming.ts`, `subzone-naming.ts`) and any other model or network path reachable under `--fast`.\n2. **`--fast` leaves `claude_commands.log` at the project root.** The only entry is `rex tree --format=json <dir>`, the PRD read behind `pr-markdown.md` (`analyzers/branch-work-collector.ts`), logged by the vendor-CLI exec wrapper. It is not a model call, but the log at the root of a scanned repository is noise and reads as one.\n\n**Fix.**\n- Under `--fast`, every judgment route is off: no Jev request and no text-model call in any phase, whatever keys or config exist. Thread it the way enrichment is already gated (the analyze context's `fastMode`), not by clearing env vars.\n- Under `--fast`, analyze writes no `claude_commands.log` in the project: either the `rex tree` read is not logged as a vendor-CLI call (it is not one), or it is skipped under `--fast` if `pr-markdown.md` can be produced without it. Pick the smaller change; `pr-markdown.md` output must not change.\n- `sv analyze --help` says `--fast` makes no model or network calls.\n- Non-`--fast` behaviour is unchanged.\n\n**Tests** (invented fixture, no network): with a judgment route forced on (stub the credential or route, as existing enrich-judge tests do), `--fast` makes zero judgment calls and zero fetches; the same run without `--fast` still calls the judge. A `--fast` run over a fixture leaves no `claude_commands.log` in the project directory."
acceptanceCriteria:
  - "With a judgment route available, sv analyze --fast makes zero Jev requests and zero model calls in every phase"
  - "A --fast run leaves no claude_commands.log in the project and pr-markdown.md is unchanged"
  - "Non --fast behaviour is unchanged"
  - "sv analyze --help says --fast makes no model or network calls"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "sourcevision"
  - "privacy"
  - "estate-readiness"
  - "php-pr12"
---
