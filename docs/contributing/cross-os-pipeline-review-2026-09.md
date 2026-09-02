# Cross-OS Pipeline Review — 2026-09-02

Does the final cross-OS validation stage earn its CI cost?

Scope: the `smoke-macos` → `smoke-windows` → `smoke-parity` chain in
[ci.yml](../../.github/workflows/ci.yml) and the comparator it runs,
`scripts/cli-smoke-parity.mjs`. Semantics of the artifact format are documented in
[cli-smoke-parity.md](./cli-smoke-parity.md); the per-case value classification is in
`tests/gauntlet/AUDIT-2026-09.md`. This document recommends and does not apply.

**Verdict: keep `smoke-parity`, tighten where it is enforced, and narrow `smoke-macos`.**
The comparison job is 1 of 71 billed minutes per run — it is not the cost problem. The cost
is `smoke-macos` at 40 of 71 (56%), and the correctness problem is that the stage's most
load-bearing assertions are not parity assertions at all, and run in the wrong job.

---

## 1. Assertion inventory

Two logically independent checks run inside `smoke-parity`, and only there. Both are applied
to both artifacts.

| Assertion | Source | Category | Runs per |
|---|---|---|---|
| `sequence` metadata equals the canonical `SMOKE_CASES` description | `compareSequence` | **structural** — both OSes ran the same case list, args, and expectations | artifact |
| `exitCode === expectedExitCode` | `compareExpected` | **smoke** | artifact |
| `stdoutExact`, `stdoutIncludes`, `stderrIncludes` | `compareExpected` | **contract** (baseline) | artifact |
| `stderrCode` matches the expected `NDX_CLI_*` code | `compareExpected` | **contract** (baseline) | artifact |
| `stdoutJson` diffed against a literal expectation | `compareExpected` | **contract** (baseline) | artifact |
| `comparable` deep-diffed macOS vs Windows | `compareArtifacts` → `diffValues` | **parity** | pair |
| `failure.code` equality macOS vs Windows | `compareArtifacts` | **parity** | pair |

The baseline checks (`compareExpected`) are per-OS assertions about the CLI. Only the last two
rows are cross-OS comparisons.

### What the parity comparison uniquely adds, per case

Parity is subsumed by the baseline whenever `expected` fully determines every field the case
projects into `comparable` — if both artifacts match the same literal, they necessarily match
each other. `diffValues` walks the union of keys, so a literal `stdoutJson` expectation pins
the whole object, not just the keys it names.

| # | Case | `comparable` fields | Baseline pins them? | Unique parity signal |
|---|---|---|---|---|
| 1 | `version-text` | `stdout`, `stderr` | `stdout` yes (`stdoutExact`); `stderr` **no** | stderr equality only |
| 2 | `version-json` | `stdoutJson` | yes (full literal) | **none** |
| 3 | `unknown-command` | `failure.code` | yes (`stderrCode`) | **none** |
| 4 | `typo-suggestion` | `failure.code` | yes (`stderrCode`) | **none** |
| 5 | `help-rex` | `stdout` (full text) | partially — 3 substrings | full help-text equality |
| 6 | `plan-help` | `stdout` (full text) | partially — 4 substrings | full help-text equality |
| 7 | `status-missing-rex` | `failure.code` | yes (`stderrCode`) | **none** |
| 8 | `status-json` | `stdoutJson` (schema/title/items) | yes (full nested literal, ordering included) | **none** |

**The cross-artifact comparison contributes unique signal on 3 of 8 cases — #1's stderr, and
the full help text of #5 and #6 — all static, OS-independent output.**

This inverts the framing in `AUDIT-2026-09.md`, which rated #7 and #8 as the two cases that
justify the stage. They are the highest-value cases *to collect on both OSes*, and that
judgement stands. But their baselines are fully specified, so the *comparison step* adds
nothing for them. What earns its keep there is running the case on Windows at all — which the
smoke jobs would do with no comparator present.

### Two structural defects

**S1 — the baseline check runs two jobs downstream of the CLI it checks.** `collect` asserts
nothing. It writes an artifact and fails only on its own JSON extraction (`SmokeCollectionError`).
So a Windows-only CLI regression leaves `CLI Smoke (Windows)` green and turns `CLI Smoke Parity`
red on an ubuntu runner. The failure is attributed to the wrong platform and the wrong job.

**S2 — the contract is unenforced on exactly the runs that have a regression.** `smoke-parity`
declares `needs: [smoke-macos, smoke-windows]`, so it is skipped whenever either smoke job
fails. The ci.yml comment acknowledges this for the artifact ("the artifact itself is intact
and the next green run compares normally") but not for the baseline: on run `32283838405`,
where the macOS root suite was red, none of the eight cases' contract assertions executed on
either platform. The job holding the CLI contract is the first thing silenced when something
breaks.

---

## 2. What CI history shows

Live GitHub Actions run history could not be retrieved — network egress is blocked in this
session and the repo has no `gh` CLI. Evidence below is the run data recorded in the PRD tree
at the time by the epic that built this matrix (`Cross-OS Behavioral Parity`, id `293eea44`),
plus git history. Run IDs are quoted from those records and were not re-verified against
GitHub.

| Run | What happened | Which stage caught it |
|---|---|---|
| `32188420459` | 3 hench test-runner cases failed on **ubuntu** — `toCommandPath` fed hardcoded backslash paths that could only pass on Windows | `validate` unit tests |
| `32190469600` | First macOS root suite — green, 96 files / 2113 tests, identical count to Windows | — |
| `32283838405` | macOS root e2e **failed** where ubuntu passed on the same sha: `pair-programming-timeout-tree-kill.test.js` assumed synchronous reaping, which holds for `taskkill /T /F` but not for POSIX `SIGKILL`. Same run, Windows independently caught a different real defect (exec resolving a timeout before the tree was dead, surfacing as EBUSY) | `smoke-macos` / `smoke-windows` **test steps** |
| `32286589689` | Green. Billed minutes measured: ubuntu 8, macOS 40, Windows 22, parity 1 = **71/run** | — |
| — | llm-client's POSIX tree kill had never worked: `execFile` silently drops `detached`, so `kill(-pid)` failed with ESRCH. CI observed the grandchild write 13 more files after the timeout was reported | ubuntu `validate` |
| PRD task `d050ace2` | `Unexpected end of JSON input` in the macOS and Windows collectors — Node deprecation warnings polluting stdout | `smoke-parity` (**harness defect, not a product regression**) |

Additional evidence from git: `scripts/cli-smoke-parity.mjs` has two commits in its history
(`bd4e9843` introducing it, `015b06ad`), neither a bug fix. No commit in the repository has
ever changed a `SMOKE_CASES` expectation in response to a failure.

**Reading.** Every real regression this matrix has caught was caught by a *test suite step*
inside `smoke-macos` or `smoke-windows`, or by `validate`. The parity comparison has failed
CI exactly once, on its own collector. The eight smoke cases have always passed.

That is not an argument for deleting them — an assertion that never fires can still be the
reason a class of bug never ships. But it does mean the stage's demonstrated value lives in
the test steps that were added to these jobs in 2026-08, not in the comparison that named them.

---

## 3. Verdict

### `smoke-parity` — KEEP, and tighten

Keep. It costs 1 billed minute (0.17 min wall), and it holds the only structural assertion in
the pipeline that both platforms executed the same canonical sequence. Removing it would also
remove the baseline contract, which nothing else enforces.

Tighten, in priority order:

- **T1 (fixes S1 and S2).** Make `collect` assert the baseline before writing the artifact, so
  a per-OS contract break fails the OS that broke it. `compare` then becomes purely a parity
  check. This is a change to `scripts/cli-smoke-parity.mjs`, not to the YAML: `compareExpected`
  already exists and is already unit-tested in `tests/unit/cli-smoke-parity.test.js`.
- **T2.** Add `stderrExact: ""` to case #1's `expected`. Today the only thing asserting that
  `ndx version` prints nothing to stderr is the cross-artifact diff, which cannot distinguish
  "both clean" from "both equally noisy".
- **T3.** The stage cannot detect separator or line-ending drift: `normalizeText` rewrites
  `\r\n` → `\n` and every `\` → `/` before anything is compared, so a genuinely wrong separator
  in user-facing output is normalised away. Cheap fix that does not reintroduce temp-path
  noise: record a shape summary alongside the normalized text — counts of `\r\n` and of
  backslashes in the raw stdout — and compare *those* across OSes. This is the one class of
  Windows bug the stage is named for and currently cannot see. (Today the only coverage is
  `tests/e2e/prd-line-endings.test.js`.)

Do **not** narrow the case list. Cases #2, #3, #4, #7 and #8 add no parity signal, but they are
free — collection is seconds, and they are the per-OS contract that T1 moves into the smoke
jobs where it belongs. Deleting them would delete the baseline, not the redundancy.

### `smoke-macos` — NARROW

40 of 71 billed minutes per run, for a job that was green in 14 of 15 runs on the branch that
introduced it. Its one catch was real and is on record, so dropping macOS entirely is the wrong
call — but paying 10× Linux rates on every PR for it is not justified by one catch in fifteen.

Narrow the *step*, not the job: gate only `Run root e2e / integration tests`. Collection stays
unconditional, so the parity contract, the job graph, the job names, and branch protection are
all untouched.

### `smoke-windows` — KEEP AS-IS

Windows is where OS divergence actually lives — path separators, file locking, CRLF, mtime
granularity, process trees — and it bills at 2×, not 10×. It has caught multiple real defects
(run `32283838405`; the mtime-granularity aggregator defect; the `sh`-absent `execShellCmd`
class fixed in `40e78ee8`). Keep it unconditional and keep the per-package suites on it.

---

## 4. Must both run on every PR?

**Windows: yes, unconditionally.** It is the divergent platform and the cheapest of the two
non-Linux runners.

**macOS: the suite step can be gated; the collect step cannot.** `smoke-parity` needs the macOS
artifact, and `needs:` propagates skips — gating the whole job would silently disable the parity
comparison. Gating the suite step alone avoids that entirely.

Recommended gate: run the macOS root suite on `push: main` and skip it on pull requests. No new
action dependency, no `fetch-depth: 0`, no path-matching logic to maintain. A POSIX-semantics
defect can then merge, but it is caught on the main-branch run — which is upstream of every
release, since `release.yml` runs from `main`.

Cost effect, using run `32286589689`'s figures: macOS drops from 3.52 min wall / 40 billed to
roughly 1 min / 10 billed on PRs, i.e. **71 → ~41 billed minutes per PR** (−42%), with the full
macOS suite still running on every merge to main.

A path-filtered variant (run the macOS suite when the PR touches `packages/core/**`,
`packages/llm-client/src/exec.ts`, `packages/hench/src/process/**`, or `tests/e2e/**`) targets
the spawn/lifecycle area where the one macOS catch occurred. It is strictly better coverage and
strictly more machinery — it needs `fetch-depth: 0` on the macOS checkout plus a diff step or
`dorny/paths-filter`. Prefer it only if a POSIX defect actually reaches main under the simple
gate.

**Hazard, if anyone later gates the whole job instead of the step:** do not reach for
workflow-level `paths-ignore`. A required status check that never starts stays pending forever
and blocks the PR, whereas a job skipped by a job-level `if:` is treated as successful. The
epic that built this matrix already recorded that job names were kept stable to avoid breaking
branch-protection required checks — the same constraint applies here.

**Not worth gating on:** docs/PRD-only commits. 4 of the last 39 commits touch no code, so a
content filter would save ~10% of runs while adding a second gating mechanism to maintain. The
`Require changeset` step already carries its own "touches no package source" logic; a third
copy of that predicate is not worth it.

---

## 5. Proposed changes (listed, not applied)

### `.github/workflows/ci.yml`

1. **`smoke-macos`** — add a step-level condition to `Run root e2e / integration tests`:

   ```yaml
   - name: Run root e2e / integration tests
     # macOS bills at 10x Linux. This step is 2.53 of the job's 3.52 wall minutes
     # (~30 of its 40 billed). It ran green in 14 of 15 runs on the branch that
     # added it; its single catch (run 32283838405, async SIGKILL reaping) was
     # real, so the job stays — but PRs get macOS collection only, and the suite
     # runs on every merge to main, upstream of every release.
     # Deliberately a STEP condition, not a job condition: smoke-parity `needs`
     # this job, and `needs` propagates skips.
     if: github.event_name == 'push'
     run: node scripts/run-vitest-bind-aware.mjs root
   ```

2. **`smoke-macos` / `smoke-windows`** — once T1 lands, the `Collect normalized smoke artifact`
   steps become the enforcement point for the per-OS baseline. No YAML edit needed; update the
   surrounding comments, which currently describe collection as assertion-free.

3. **`smoke-parity`** — no change. Its `needs`, timeout, and runner are all correct.

### `scripts/cli-smoke-parity.mjs`

4. **T1** — have `collect` run `compareExpected` against each case after collection and exit
   non-zero on any issue, before `writeFileSync`. Note the ordering constraint the existing
   ci.yml comments rely on: the artifact must still be written and uploaded when the *test*
   steps fail. Baseline failures are a different thing — they mean the artifact records a
   broken CLI, and failing before the write is correct. Confirm this against the
   `smoke-parity`-skipped-on-red behaviour before implementing.
5. **T2** — add `stderrExact: ""` to the `version-text` case's `expected`, and handle
   `stderrExact` in `compareExpected` alongside `stdoutExact`.
6. **T3** — add a `shape` field to each collected case holding `{ crlfCount, backslashCount }`
   computed on the *raw* streams before `normalizeText`, and compare it in `compareArtifacts`.

### `tests/unit/cli-smoke-parity.test.js`

7. Cases for each of T1–T3: collect rejects an artifact that violates the baseline; `stderrExact`
   is enforced; a CRLF/backslash shape divergence fails parity while an equal shape passes.

### Docs

8. `docs/contributing/cli-smoke-parity.md` — the "Baseline Contract" section states that
   `compare` validates the baseline. After T1 that moves to `collect`; update it in the same
   change. Its claim that CI can "ignore expected OS-specific differences such as temp paths,
   shell wording, and native process messages while still failing on real semantic drift"
   should also state the limitation T3 addresses: separator and line-ending drift is normalised
   away, not detected.

---

## Summary

| Stage | Billed min/run | Verdict |
|---|---|---|
| `smoke-parity` | 1 | **Keep**, tighten (T1–T3) |
| `smoke-macos` | 40 | **Narrow** — gate the suite step to `push: main`, keep collection on every PR |
| `smoke-windows` | 22 | **Keep as-is** |
| `validate` (ubuntu) | 8 | Out of scope |

The comparison step is cheap and holds a contract nothing else holds. Its problem is not cost
but placement: the assertions that matter are per-OS baselines being enforced two jobs
downstream, where they are skipped precisely when a platform is red. Fix the placement, add the
separator/line-ending check the stage is named for, and take the macOS saving out of the suite
step rather than the parity job.
