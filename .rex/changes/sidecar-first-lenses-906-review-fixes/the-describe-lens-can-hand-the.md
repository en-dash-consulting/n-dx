---
id: "5117c0f4-6547-4140-8dae-dc14970ce123"
type: "task"
title: "The Describe lens can hand the operator a rex update that drops the task's other done-when checks"
slug: "the-describe-lens-can-hand-the"
description: "Verdict: should-fix (from the adversarial review of e66d734c).\n\nDESCRIBE_INSTRUCTIONS (packages/web/src/server/sidecar/lens-instructions.ts:34) tells the agent to give tightened wording for each vague check and say the operator applies it with `rex update`. But `rex update --criterion` replaces the whole list. Scenario: a task has checks A (clear), B (vague) and C (clear). The agent replies with `rex update <id> --criterion=\"B tightened\"`, the operator runs it, and A and C are gone. The loss is silent, and git is the only way to recover them.\n\nReachable: the Describe lens in the Sidecar drawer, on any task with a mix of vague and clear checks, when the model writes the command out. Not covered: no instruction or test mentions that `--criterion` replaces the list.\n\nOptions:\n(1) Add one clause: if the agent writes a `rex update` command, it lists every check, both kept and tightened, because `--criterion` replaces the whole list. Cheap. The cost is a snapshot update.\n(2) Tell the agent never to write the command and to name the item editor only. This loses the CLI path.\nRecommend (1)."
acceptanceCriteria:
  - "DESCRIBE_INSTRUCTIONS says that a `rex update` command the agent writes lists every done-when check, kept and tightened, because `--criterion` replaces the whole list"
  - "sidecar-packets.test.ts asserts that wording, and the snapshot is updated"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
