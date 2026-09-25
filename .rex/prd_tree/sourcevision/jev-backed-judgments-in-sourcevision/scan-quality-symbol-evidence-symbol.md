---
id: "ed9a4a88-48f0-4aca-8db9-d52dd70aa74e"
level: "task"
title: "Scan quality: symbol evidence, symbol/README name candidates, typed anchored findings, declared-rule checks"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "llm"
  - "typesafe"
source: "ndx-capture"
acceptanceCriteria:
  - "Unit test: buildZoneEvidence includes exported symbols, top-level declarations and test file names when imports/callgraph data is available, and is unchanged when it is not"
  - "Unit test: name candidates include the symbol-noun, README-title and package-description forms when present, deduplicated with the directory forms"
  - "Unit test: each typed finding is emitted with anchors from its edges and judged with those edges in the state; a confirmed one keeps severity, an artifact drops to info"
  - "Unit test: rules extracted from a doc are cached by doc hash, a crossing judged as violating a rule becomes an anti-pattern citing the source, and a repo without docs makes no rule request"
  - "Live on caos and this repository: name fallbacks needed (before/after), share of heuristic findings outside the uncertain band (before/after), count of findings with anchors; recorded in this item's log"
  - "pnpm --filter @n-dx/sourcevision test passes; prompt-text-identity snapshots unchanged"
description: "The judgments are fast; their evidence is thin (paths plus 2,500 chars of leading comments per zone) and their findings are mostly metric paraphrase. On caos 23 of 25 zones went to `none` on directory-derived name candidates and 41 of 41 heuristic findings landed in the uncertain band. Four changes, each independent:\n\n**1. Symbol evidence.** The repo already computes exported symbol names (re-export edges in `imports.json`) and the call graph (`callgraph.ts`). Add per zone to the judged state: the most common exported symbol names (≤ 30), the top-level declarations of the sampled files, and test file names. Feed the same to the naming, fragility, heuristic and finding-evidence requests through `buildZoneEvidence`.\n\n**2. Name candidates from what the code says.** Add candidates from the dominant noun in exported symbol names (`StandupService`, `StandupRepo`, `useStandup` → \"Standup\"), the nearest `README.md` title under the zone's dominant directory, and `package.json` `description`. Keep the directory candidates. Expect the generated-name fallback to become rare.\n\n**3. Typed findings with anchors by construction.** A small library of deterministic findings computed from the graph — layering violation, cycle member, hub file, test-only module, dead export, boundary crossing with no interface module — each carrying `anchors` from the edges that produced it. Each is judged by Jev for \"real problem?\" with those exact edges as evidence (the heuristic Noul, given better evidence). The text model then explains only confirmed findings, in one call, or not at all. Retire the metric-paraphrase heuristics these replace (entry-point width, raw cohesion/coupling lines) or keep them at `info`.\n\n**4. Declared-rule checks.** Extract the project's architecture rules once from `CLAUDE.md` / `ARCHITECTURE.md` / `hints.md` (one generative call, cached by doc hash, into `.sourcevision/.cache/rules.json` as `{ rule, source, quote }`), then ask Jev per cross-zone edge class: *does this crossing violate rule R?* Confirmed violations become `anti-pattern` findings citing the rule's source line. Repos without such docs skip the step.\n\nAlso record, from the caos and n-dx runs, the agreement rate between the current heuristic Noul and the typed-finding Noul on the same zones, so the band can be set from data."
lastModified: "2026-09-22T14:17:58.714Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
