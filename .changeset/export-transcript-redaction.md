---
"@n-dx/core": patch
"@n-dx/web": patch
---

`ndx export` no longer publishes agent transcripts by default, and `--deploy=github` confirms before pushing.

Every `.hench/runs/*.json` was copied verbatim into the static site —
`toolCalls[].input/output`, `events`, `error` bodies — and `--deploy=github`
force-pushed the result to `origin/n-dx-dashboard` with no prompt. A run that
had `cat`'d a `.env` or printed `process.env` put that on the remote; the
project's own discovery notes had already called this a blocker. The default
out-dir `./ndx-export` sat inside the repo and was not gitignored either.

- Exported run records are passed through `sanitizeRunForExport`, which drops
  `toolCalls`, `events`, `error`, `diagnostics.promptSections` and
  `testGate.error`, keeps summaries and token usage, and stamps
  `transcriptOmitted: true` so the static Task Audit view can say why the
  transcript is absent. `--include-transcripts` opts back in.
- `--deploy=github` builds a manifest (remote, branch, run count, PRD item
  count, transcript inclusion) and asks before doing any work. Without a TTY
  it stops with exit 1 unless `--yes` is passed — nothing is written or pushed.
- `ndx init` and `ndx export` both add `ndx-export/` to `.gitignore`; the
  shipped template carries it too. `ensureGitignoreEntry` moved to
  `packages/core/gitignore.js` so both callers share it.
- The dashboard's `POST /api/commands/export` forwards `--yes` only when the
  body carries `confirmDeploy: true` (set by the viewer's confirmation step)
  and refuses a deploy request without it; `includeTranscripts: true` maps to
  `--include-transcripts`. The confirmation dialog now says what is published.

Found by the 2026-09-11 adversarial security review (finding B).
