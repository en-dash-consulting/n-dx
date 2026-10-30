---
id: "5aa5da8f-9587-4ff6-a27a-379525a7fc04"
type: "task"
title: "Hench recommends execution order and loop bundles for ready tasks"
slug: "hench-recommends-execution-order-and"
description: "Rule-based, LLM-free queue planner in hench, advisory only. ndx work --plan-queue [--format=json] passes through to hench, which prints the plan and exits without starting a run, claiming a task or writing a file. Input: the ready list in selection-comparator order with claims respected; per task its tags, effective tier (saved run.tier, else the parent change run.tier, else the hench default), blockedBy and parent change; per change its touches (product node ids; touches is a change-level field, so tasks under one change share it); and the runs active now. A lane is one branch in one worktree running its tasks one after another: ndx work --task=a --task=b. Rules: a lane holds 1 to 3 tasks of one parent change, each with effective tier light or standard; tasks linked by blockedBy run in dependency order. Lanes offered together must come from changes with pairwise disjoint touches; a change with no touches is never paired with another lane. Tasks tagged review-critical, migration or cross-package are excluded (cold-only). Lanes offered = guard.maxConcurrentProcesses (default 3) minus runs active now. Output: ordered lanes, each with its exact command, plus a one-line reason for every ready task, included or excluded. On Live, with the hench.readyNext toggle on, a Ready next section takes the place of the Up next list; with it off Live is unchanged. The web server gets the plan by spawning the CLI through the existing ndx spawn path in routes-hench.ts (resolveNdxBin), never by importing @n-dx/hench and with no new node:child_process import. Soft freeze: no rex or sourcevision MCP tool shape changes. CAOS story: https://www.notion.so/3f7a80b719248118bf40ee8742778786."
acceptanceCriteria:
  - "ndx work --plan-queue --format=json . prints lanes [{command, tasks: [{id, title, reason}]}], excluded [{id, title, reason}], activeRuns and runLimit, and exits 0 without starting a run, claiming a task or writing any file (a test asserts the runs directory and the PRD are unchanged)"
  - "Every lane holds 1 to 3 tasks of one parent change, each with effective tier light or standard; tasks linked by blockedBy appear in dependency order"
  - "Lanes offered together come from changes with pairwise disjoint touches; a change with no touches is never paired with another lane"
  - "Tasks tagged review-critical, migration or cross-package are excluded with a reason naming the tag"
  - "Every ready task appears exactly once, in a lane or in excluded, with a one-line reason"
  - "The lane count never exceeds guard.maxConcurrentProcesses minus active runs; with no free slot the output has no lanes and says why"
  - "Unit tests cover each rule with fixture PRDs: same-parent grouping, the 3-task cap, a heavy tier, each cold-only tag, a dependency chain, overlapping touches and a full run limit"
  - "With hench.readyNext on (registered in routes-features.ts, package hench, default off, stability experimental), Live shows Ready next with each lane command and its reasons; with it off Live is unchanged; the endpoint behind it is listed in ROUTE_FEATURE_GATES"
  - "The patch changeset carries release-note lines for ndx work --plan-queue and Ready next"
priority: "medium"
source: "caos"
---
