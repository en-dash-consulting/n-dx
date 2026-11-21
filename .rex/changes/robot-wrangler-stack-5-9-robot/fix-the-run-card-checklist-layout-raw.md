---
id: "6b80597e-2cd6-4882-8674-8e326cfe3f1b"
type: "task"
title: "Fix the run card checklist layout, raw colour codes, repeated used-by labels and the failover note found in PR 5 review"
slug: "fix-the-run-card-checklist-layout-raw"
description: "A review of the finished Robot Wrangler page at 1440px, dark and light, found four problems to fix before the PR goes out. All the files are in `packages/web/`.\n\n1. **Run card checklist (`views/robot-wrangler.ts`, `styles/robot-wrangler.css`).**\n   - The right-hand checklist column is so narrow its text wraps almost word by word (\"llm.claude.ap / i_key or ANTHROPIC_API_KEY\"). Give the checklist a fixed comfortable width (around 300px) beside a flexible left side, and stack it under the left side below about 900px.\n   - Each checklist row shows a short label plus its action: \"Credentials valid\" with Re-check; \"CLI 2.1.296\" or \"CLI not found\"; \"Built-in model list\" or \"Live model list\" with Refresh. Put the long detail (the catalog `reason`, the full credentials message) in a `title` tooltip or a small muted second line that wraps normally, never squeezed.\n2. **Raw colour codes (#660 item 5).** `GET /api/commands/auth` (`handleAuth` in `src/server/routes-commands.ts`) returns the CLI's stdout unmodified, so the run card shows `[32m✓ Credentials valid … [39m`. Strip ANSI SGR sequences server-side before returning `output`, using the same regex `parseRefreshPhases` already uses in that file. Add a unit test.\n3. **Repeated used-by labels.** The tier table shows \"rename/merge, rename/merge\" and \"change placement, change placement (Jev)\" because several task classes map to the same or overlapping label. Deduplicate labels within each tier row, keeping first-seen order. Where two labels differ only by a suffix such as \" (Jev)\", fold them into one. Do this server-side in the tier table builder (`src/server/llm-tiers.ts`), so every consumer gets clean labels, and extend its test.\n4. **Failover note and pending edits.**\n   - When `failover.applies` is false, the reason renders as a red bordered error box. It is information, not an error: show it as a muted warning line (an orange `!` and normal text colour, no red border), matching the Review section's unavailable note.\n   - While edits are pending, the failover section must use the preview response's `failover` block (the run card already calls `POST /api/llm/config/preview`), so its chain and reason match the vendor the run card previews. With no pending edits, it uses the saved config as now.\n\nKeep every existing test passing and update the ones these changes touch.,"
acceptanceCriteria:
  - "At 1440px the run card's checklist rows each fit on one or two lines with no mid-word wrapping, and below about 900px the checklist stacks under the model."
  - "`GET /api/commands/auth` returns `output` with no ANSI escape sequences (unit test), and the run card shows no `[32m`-style codes."
  - "No tier row's used-by list repeats a label, and suffix-only variants such as \"(Jev)\" are folded together (server test)."
  - "The failover reason renders as a muted warning line, not a red error box."
  - "While a vendor change is pending, the failover chain and reason come from the preview response and match the run card's vendor."
  - "`pnpm --filter @n-dx/web test`, the package typecheck, and the root affected test gate pass."
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
source: "claude-code: Robot Wrangler redesign session 2026-10-11 (overnight PR stack) — review of the finished PR 5 page at 1440px"
---
