---
id: "5765f34a-5471-4bdb-9b20-4b7b3ab51813"
type: "change"
title: "Live's monitor spawns git twice every tick to read the work-set branch"
slug: "live-s-monitor-spawns-git-twice-every"
intent: "Found by the adversarial review of task d25d1516 (branch work set server routes). In packages/web/src/server/routes-live.ts, nextTasks() calls currentWorkSetBranch(projectDir) on every snapshot build so the branch can key the next-queue memo. That runs `git symbolic-ref` and the default-branch check through execFileSync. startLiveMonitor rebuilds the snapshot every 2 s (LIVE_MONITOR_INTERVAL_MS), so a served v2 workspace now makes about two synchronous git spawns per tick on the event loop. That is the per-tick work the nextByExcluded memo exists to avoid. On a memo miss, findNextWorkTask with `workspace` reads the branch again. Reachable whenever the dashboard serves a v2 project with Live monitored. Severity is low: a few ms to tens of ms of blocked event loop per tick, and no wrong answer. Verdict: should-fix.\n\nOptions:\n(a) Read HEAD cheaply: stat or read `<gitdir>/HEAD` and key the memo on its mtime or contents, and spawn git only when it changes. Low cost; it needs the gitdir, which for a worktree is a `.git` file.\n(b) Cache the branch per projectDir with a short TTL, such as LIVE_CACHE_TTL_MS. Simplest, but a checkout shows up a little late.\n(c) Watch `.git/HEAD` from the workspace hooks and invalidate on change. Most exact, but it adds a new watcher.\nRecommend (a) or (b)."
acceptanceCriteria:
  - "Building the Live snapshot twice with no checkout in between spawns git at most once to read the branch (a test counting spawns or calls fails today)"
  - "After a git checkout, Live's next queue reflects the new branch's work set within one monitor tick"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
discoveredFrom: {"item":"d25d1516-fa91-4a86-86a0-b7b51b1e604e","run":"8a5a6fc0-0100-4bdb-8c4c-56933ce9853e"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
