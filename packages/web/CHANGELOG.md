# @n-dx/web

## 0.10.4

### Patch Changes

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`ff4a6ff`](https://github.com/en-dash-consulting/n-dx/commit/ff4a6ffc0d060b82a32d4bfea3536cf64c44f4c0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The PRD tree `Add item` form accepts a Done when list and comma-separated tags, and sends both with the new item.
  
  Criteria can be added and removed one at a time.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`9e19619`](https://github.com/en-dash-consulting/n-dx/commit/9e19619d6d054b63620aeacfbe72a17f6c609c8b) Thanks [@endash-shal](https://github.com/endash-shal)! - Open changes offers `Apply all…` for every change that is done and waiting to apply: it previews each one, then applies those that can in one step.
  
  Each change applies against its own preview, so one edited since is skipped and named while the rest apply. If an apply fails partway through, for example because another command holds the PRD, the changes already applied are still reported and the rest are listed as not applied. A change still held in the Inbox is placed first, so Apply all leaves it out. The bar links to Settings → Workflow, whose `Apply amendments` choices now read in plain words: automatically when a change is done, after someone applies it, or when a release is stamped.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`2b427e0`](https://github.com/en-dash-consulting/n-dx/commit/2b427e0ee976dab56f40ae5846d9463918b04808) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The credential-check cache is keyed by the effective vendor and its `llm.<vendor>` settings, so a config change made outside the dashboard no longer serves the previous vendor's verdict.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`e075c46`](https://github.com/en-dash-consulting/n-dx/commit/e075c46829f56f696424e1f6f03a95d535e0fab6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's `Robot Wrangler` reuses credential verdicts for up to five minutes across visits, avoiding repeated vendor checks while tracked authentication inputs remain unchanged.
  
  Checks observe effective vendor settings, the server's authentication environment, workspace trust records, and credential-store metadata when the API check depends on that store. Dashboard settings and trust changes invalidate only their workspace, including pending checks.
  
  External CLI login, keychain state, helper output and provider-side revocation are not detected directly. Successful and failed verdicts expire five minutes after a check starts; use `Re-check` to check those external changes immediately. It bypasses completed verdicts while concurrent checks of the same context share work. Read-only tiles stop returning expired verdicts without launching a check. The auth subprocess timeout remains 60 seconds, separate from the cache lifetime.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`4f0d484`](https://github.com/en-dash-consulting/n-dx/commit/4f0d4843b1d525756160c1b1ac6483b20fd844fc) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's `Robot Wrangler` credential checks keep each workspace's result separate, including when checks run concurrently.
  
  Checks share work only when their workspace and effective vendor configuration match. Project-local configuration still takes precedence, and changing contexts no longer replaces another context's cached verdict.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`0e40be1`](https://github.com/en-dash-consulting/n-dx/commit/0e40be1173141f9dda359bfef36ea59e89a12e31) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A v2 change with no tasks offers `Start`, run history, usage and saved run settings on the dashboard.
  
  The Changes view reads "runs as one task". The server marks such a change `runsAsOneTask` from rex's selection rule; a change with tasks, or one holding a change, still refuses run settings.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`ab81666`](https://github.com/en-dash-consulting/n-dx/commit/ab81666a7198577f0d7ad48ac08986d7ef49a850) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Codex Sidecar (experimental, off by default; enable with `web.sidecar`) uses complete disabled entries for project MCP servers so turns can load their configuration.
  
  Each project MCP server except `ndx-sidecar` is turned off with `enabled=false` plus a placeholder matching its declared transport: `command="ndx-sidecar-disabled"` for stdio or `url="http://127.0.0.1:9/ndx-sidecar-disabled"` for HTTP. The entry is valid whether or not Codex loads the project `.codex/config.toml`; a server declaring neither or both transports refuses the turn. A turn that still reaches an MCP server other than `ndx-sidecar` is stopped, and the reason is shown.
  
  Action needed: If a turn refuses an ambiguous transport, edit the named `.codex/config.toml` so each server declares exactly one `command` or `url`.
  
  The original codex-cli `0.166.0` report showed that `--ignore-user-config` skips the project config and an `enabled=false` override alone fails transport validation. Final broker behavior on `0.166.0` and `0.164.0-alpha.11.1` remains unverified here; parser and scripted argv tests do not establish live CLI compatibility.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`627f8f4`](https://github.com/en-dash-consulting/n-dx/commit/627f8f4b3158facdd176cae7d562eab8bcd9f776) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Codex Sidecar (experimental, off by default; enable with `web.sidecar`) connects turns to the broker under a read-only policy.
  
  Codex Sidecar turns, fresh and resumed, spawn with `--ignore-user-config`, `features.apps=false`, `features.shell_snapshot=false`, the read-only policy (re-applied on resume) and the `ndx-sidecar` broker as `-c mcp_servers.ndx-sidecar.*` flags: url, `required`, a 30 s startup timeout and a tool timeout of the session idle window. The broker headers travel as `env_http_headers` variables set only in the Codex child's environment and blanked in the agent's commands, so the credential is never in argv or an MCP config file. Other project MCP servers receive complete disabled entries (`enabled=false` plus a placeholder `command` or `url`).

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`d6b1896`](https://github.com/en-dash-consulting/n-dx/commit/d6b1896792ae0aa5af95c1d940debbf084b5fbc3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar (experimental, off by default; enable with `web.sidecar`) supports Codex worktree sessions and turns; hub sessions stay Claude-only.
  
  Every Codex turn, fresh and resumed, re-reads each project `.codex/config.toml` from the checkout up to the repository root and turns off every MCP server it declares except `ndx-sidecar`. Each receives a complete disabled entry: `-c mcp_servers.<name>.enabled=false` plus a placeholder `command` for stdio or `url` for HTTP. The entries are valid whether or not Codex loads the project file. An unreadable or unsupported project config, a server name that is not a bare TOML key, or a server declaring neither or both transports refuses the turn before anything is spawned, with a reason naming the file. User configurations selecting a non-default model provider remain unsupported.
  
  Action needed: If a turn refuses a project config, repair the named `.codex/config.toml`; use bare server names and exactly one `command` or `url` per server. For a non-default Codex provider, select Claude for the Sidecar.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`5e1246b`](https://github.com/en-dash-consulting/n-dx/commit/5e1246b96ba207d5b1626b001524f393d7a64411) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Codex Sidecar (experimental, off by default; enable with `web.sidecar`) explains incompatible user-configured model providers before starting.
  
  A Codex Sidecar session is refused when the user's Codex config (`$CODEX_HOME/config.toml`) selects a model provider other than `openai`, at the top level or through the selected profile: Sidecar turns skip that config, so the provider would not apply and every turn would fail auth. Create answers 400 and records nothing; a turn answers 409 and spawns nothing. A config that cannot be read refuses too. The reason names the provider and the file. Claude sessions are unaffected. llm-client exports `codexUserModelProvider` and `codexUserConfigPath`.
  
  Action needed: Select Claude for the Sidecar if your Codex setup requires a non-default provider, or use the default `openai` provider. If the user config cannot be read, repair the named `$CODEX_HOME/config.toml`.
  
  Provider forwarding is not implemented. Provider selections inside inline tables are not detected by this check and can still fail authentication; no live Azure-specific verification is claimed.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`235c988`](https://github.com/en-dash-consulting/n-dx/commit/235c988e6b309deaa41237a07be1fb30861e7f5d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's `Add New Item` form preserves acceptance criteria drafts when Enter confirms IME input, including compatibility events.

- [#1020](https://github.com/en-dash-consulting/n-dx/pull/1020) [`9222084`](https://github.com/en-dash-consulting/n-dx/commit/9222084daa1d528329c786071b5e15afef6bb7ea) Thanks [@endash-shal](https://github.com/endash-shal)! - New `hench.projectSkills` setting names project skills that `ndx work` agents read before the work each one covers (opt-in, default none).
  
  Each name is a directory under `.claude/skills/` or `.agents/skills/`. Every run's system prompt lists the named skills by path and description and tells the agent to read the file first, because a run cannot invoke a skill by name: hench does not grant Claude's `Skill` tool, whose `allowed-tools` frontmatter could widen the run's command policy. A name with no `SKILL.md` is skipped with a warning. The setting is opt-in because the same directories hold operator workflows such as `ndx-work` that a running agent must not follow. Set it with `ndx config hench.projectSkills '["<name>"]' .`; the dashboard lists it under execution settings.

- [#1009](https://github.com/en-dash-consulting/n-dx/pull/1009) [`f663dc0`](https://github.com/en-dash-consulting/n-dx/commit/f663dc0950b5f243ddc87fbb59172b18fbfae81e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Live's container is centred in the free width, so no gutter shows on its right on wide windows or after the Sidecar drawer closes.

- [#1009](https://github.com/en-dash-consulting/n-dx/pull/1009) [`9885ccf`](https://github.com/en-dash-consulting/n-dx/commit/9885ccf751000a7b113d8f0921f48a4b730501f3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Analysis next steps: a long file path in a step title wraps inside the row, so the copy button stays in the row instead of being clipped by the tile.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`568023b`](https://github.com/en-dash-consulting/n-dx/commit/568023b74d8b42754f8426e820167f0494981e8b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Browser-pasted Notion URLs now read back as CAOS ids.
  
  Workspace paths, title slugs and query strings are accepted, so tracker moves for a change linked that way are no longer refused.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`d37f6e7`](https://github.com/en-dash-consulting/n-dx/commit/d37f6e72999ab64f1430a8cf0a6e0ffe45227866) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Board-view Notion peek URLs now resolve to the page id.
  
  The `p=` parameter takes precedence over the database id in the path, so the tracker move is no longer refused.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`6b79868`](https://github.com/en-dash-consulting/n-dx/commit/6b79868c128eb4063050ce93f73a457246c65152) Thanks [@endash-shal](https://github.com/endash-shal)! - Plan: Open changes is a table of change, size, progress and status. Size reads Small, Medium or Large (the file count is in its tooltip and the detail panel), progress is a percentage, and status is one word (Planned, Ready, Working, Waiting when blocked, Done when awaiting apply) with the full stage on hover. Security and Essential flags follow the name; tracker and Describe actions show on hover.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`748d4f2`](https://github.com/en-dash-consulting/n-dx/commit/748d4f26e3aa2f5a865373215c009fb2e2821a3e) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard rows on Plan and Work lead with an item's plain-language summary and show impact tags for size, security-sensitive files, essential files and file kinds.
  
  The technical title stays as the row's tooltip and the detail panel's heading, and the detail panel gains an editable "In plain terms" field. Tags come from the files runs changed or, before any run, the files the item names. `GET /api/rex/impact` serves them, and the detail panel lists the files behind each tag. Tags on an open page update when a run lands or the PRD changes, and the Tasks search finds an item by its summary.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`5312457`](https://github.com/en-dash-consulting/n-dx/commit/5312457fb08315b340cd6cf8ce377fe630e8e01d) Thanks [@endash-shal](https://github.com/endash-shal)! - Plan: the product area map tile is gone, because readers could not tell what its blocks meant. The Product page is now a tab of Open changes, and its routes, area pages and placement links work as before. Each area's heading on the Product page opens that area's page.

- [#1009](https://github.com/en-dash-consulting/n-dx/pull/1009) [`c01f270`](https://github.com/en-dash-consulting/n-dx/commit/c01f2709d4b5ea41a5d6112d1dd7ea89babdef84) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Plan: the area map's "N open" badge no longer covers the area name, and names wrap between words instead of breaking mid-word; stage tile heads keep the count badge beside the title.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`7fc63a4`](https://github.com/en-dash-consulting/n-dx/commit/7fc63a4d31e043a2deaaa949c50db0c4a70c0fee) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's `Status` block shows run holds only when placement, reopening a change, or running the parent task offers a next step.
  
  Ordinary containers and tasks of applied changes stay quiet. Visible holds use the status block's supporting-text styling. Execution and saved-settings guards remain unchanged.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`0d68772`](https://github.com/en-dash-consulting/n-dx/commit/0d68772a917d5865fa20bbea0f56985ee593ed55) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's `PRD` tree updates task `Start` controls after placing or applying a change, without a reload.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`e8d8926`](https://github.com/en-dash-consulting/n-dx/commit/e8d89269bbd37fbce284159b052cf8011043bd75) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Product page's Constraints table now shows each open change a constraint carries.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`433f693`](https://github.com/en-dash-consulting/n-dx/commit/433f6937f745b3d54f20909a9b802c3e41e374fb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Product page's Open changes total counts a change that only touches or amends a top-level constraint. `GET /api/rex/product` carries `openChanges` on each constraint row.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`49a9582`](https://github.com/en-dash-consulting/n-dx/commit/49a9582896965202ac695b31eb013e20b719e3e9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - When the Product page's map read fails, the Map/Requirements tabs stay on screen with the error in the Map panel, so the Requirements view is still reachable without typing `/requirements`.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`85945fa`](https://github.com/en-dash-consulting/n-dx/commit/85945fa14d4b2d0ff0a835cb8c48998a7d5e328d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The `Sidecar` transcript (experimental, off by default; enable with `web.sidecar`) preserves tool-result vendor semantics when output begins with `[error]`.
  
  Canonical Claude successes without an error flag remain successful. Unflagged Codex output retains unknown status and is not marked failed from its text alone. Archived Claude results keep their prefix fallback, and explicit error flags retain precedence.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`4577e10`](https://github.com/en-dash-consulting/n-dx/commit/4577e1002d92d5003fa931fd0d0e490a6559d18e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The `Work` page's Show all toggle exposes its expanded state and identifies the Ready to run list for assistive technology.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`b864445`](https://github.com/en-dash-consulting/n-dx/commit/b864445c5073f7c7003e3c756be0a73c2a11e803) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `Ready to run` searches readable summaries as well as technical titles and reuses the complete queue when you clear filters or toggle Show all.
  
  After a failed full-queue request, reopening Show all or using a filter retries loading the remaining tasks. Successful full queues stay reusable, and run updates refresh the current rows.
  
  The list keeps its first ten rows, technical title tooltips, impact tags, and Prepare/Resume menu controls.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`3e253b3`](https://github.com/en-dash-consulting/n-dx/commit/3e253b3246f945f126ace2dbd68c7cb8f57aeb8b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `Ready to run` lists every runnable task with Show all, search, and priority, change and tag filters.
  
  The route pages through tasks with hench's v2 selector: Inbox changes never list, a task-less change is one unit, and a change with tasks lists its tasks. Each row names its change.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`71684a6`](https://github.com/en-dash-consulting/n-dx/commit/71684a6d817f0ebc0c40fdf448a6ab0943c53180) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `Ready to run` loads its complete queue in one request, including on live refresh.
  
  `GET /api/hench/ready?all=1` replaces requests for successive 50-row pages, so selection and the hench runs scan each run once per load.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`23d9ae0`](https://github.com/en-dash-consulting/n-dx/commit/23d9ae07510be0c62f8dab8410ad7896393f4f6b) Thanks [@endash-shal](https://github.com/endash-shal)! - Work: Ready to run shows the next three tasks, with a "Show N more" toggle for the rest of the list.

- [#1014](https://github.com/en-dash-consulting/n-dx/pull/1014) [`9e3a08f`](https://github.com/en-dash-consulting/n-dx/commit/9e3a08fb2fd5ab7b792d6ac79a130307f2e59776) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard's run control finds the app's localhost link when the dev server colours it (Vite bolds the port), and offers it as an Open app button opposite Stop. Command output renders its terminal colours instead of showing `[0m` codes, and starts collapsed to its last three lines with a toggle for the full log.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`17ab435`](https://github.com/en-dash-consulting/n-dx/commit/17ab435c842b4832a8a1fea46fe8ba79c73a23c8) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Run controls say "Start" and the Live view "Live run". On a v2 tree, Live's running and Up next rows, the Sidecar work card and the run-plan card's track rows read "<task> · in <change>", or "<change> · runs as one task" for a change with no tasks. The queue plan JSON gains an additive `changeTitle` per lane.

- [#1011](https://github.com/en-dash-consulting/n-dx/pull/1011) [`d007823`](https://github.com/en-dash-consulting/n-dx/commit/d0078230c7ada1b710f97e4cf8b7620ce5888a11) Thanks [@endash-shal](https://github.com/endash-shal)! - n-dx recovers from a stale build itself instead of telling you to rebuild. On a source-linked checkout, `ndx start` (hub, `--here` and `--preview`) rebuilds `@n-dx/web` and the workspace packages it depends on when its `dist/` is older than its source, says so, and then spawns; a command whose package `dist/` is missing builds it and runs; `ndx export` builds a missing viewer. A failed automatic build exits non-zero with the build's own output. A published install missing a built file says it is incomplete and to reinstall.
  
  `ndx start` replaces a running hub that is older than the one it would start (see below for what counts as older): it stops that hub, starts the current build on the same port and home, and brings every project from `hub.json` back on its own `/p/<id>/` URL, then prints the sign-in link as usual. When an agent run or an MCP session is live on the old hub, the replacement is deferred to the first `ndx start` after that work ends, and `--replace-hub` forces it now. Project servers answer `GET /api/live-work` with what a restart would cut off: open MCP sessions and Sidecar turns in progress, the hub-scope Sidecar's included, all of which defer a replacement. A project whose live work cannot be read (a timeout, a server error) defers it too, and the note names that project; a server too old to have the route, or a project with no running server, has none. A start that fails once the old hub is stopped is tried again, and a second failure says that `hub.json` is intact and the next `ndx start` brings every project back.
  
  A hub running in the other authentication mode than `ndx start` asked for is replaced in the requested mode the same way, instead of `ndx start` asking you to stop it: an open hub becomes a token hub, and a token hub becomes an open one only when the command asked for no token (`--no-auth`, `web.auth=false`) and passed `--replace-hub`, which the notice says. Without `--replace-hub`, such a command joins the token hub and is served with the token, so one project's setting never turns the token off for every project on the hub. With live work on it the replacement defers, and an open hub still never serves a project that wants the token.
  
  Hub-side faults no longer end in restart advice. A hub started without `--ndx-cli` finds `@n-dx/core` beside its own package; a hub with no n-dx binary looks for its own entry again before each start and health check; `/api/hub/health` reports what is still missing as `faults`, and `ndx start` replaces such a hub. A sidecar stop the hub does not confirm is a note and no longer fails `ndx extensions disable`/`enable`/`remove`/`add`.
  
  `ndx start` replaces only a hub older than itself: one with no build identity, an older `@n-dx/web` version, or an earlier build of the same checkout (`/api/hub/health` now reports the hub's package root). A newer hub, or one started from another checkout, keeps serving, with a one-line note.
  
  When the automatic rebuild of a `dist/` that is there but lags its source fails, or another process still holds the rebuild after the wait, `ndx start` warns with the build's output and goes on with the existing build, leaving an older hub serving; only a missing build is fatal.
  
  When `ndx start` replaces the hub, signed-in dashboard tabs stay signed in: the old hub hands its live sessions (as digests, in an owner-only file the new hub deletes on reading) to the new one. `ndx hub stop` still signs every tab out. `@n-dx/llm-client` exports `writeOwnerOnlyFile`.
  
  Two `ndx start` that replace the same older hub at once both succeed: the second joins the hub the first started instead of failing on the port, and never stops it — a replacement stops only the hub it judged.
  
  The automatic rebuild's lock is claimed atomically when its owner is gone, and is stale once older than any rebuild may take, so two waiters never build into one `dist/` at once.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`d2e7482`](https://github.com/en-dash-consulting/n-dx/commit/d2e7482e0cefc53306c93dd684644006d10241eb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar (experimental, off by default; enable with `web.sidecar`) can ask the operator to pick between options.
  
  A new `ask_choice` broker tool raises a choice card with a radio (or checkbox) row per option, arrow-key movement, an Other free-text row and a Send button; the answer returns to the agent as the tool result. It writes nothing, and every worktree lens now tells the agent to use it for a decision instead of listing options in its reply.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`c96ea94`](https://github.com/en-dash-consulting/n-dx/commit/c96ea941a3be038ba6ee7ac743b87b2474010a8c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar change-set card (experimental, off by default; enable with `web.sidecar`) carries editable tags into newly approved items.
  
  `propose_prd_change` takes optional `tags` per item, the card shows them in an editable field, and approval writes them to the new items.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`43bd99c`](https://github.com/en-dash-consulting/n-dx/commit/43bd99cc7e69fcfb8e589fea9d083f95686c0fd9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar (experimental, off by default; enable with `web.sidecar`) shows a checkpoint diagnostic and starts the next turn with fresh context when checkpointing fails.
  
  Any measured checkpoint usage spent is recorded once, including usage from a checkpoint that started but failed. Checkpoint failures show a diagnostic and mark the next turn for fresh context, whatever the cause.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`913d868`](https://github.com/en-dash-consulting/n-dx/commit/913d86826ac5929e9dbcb40173f93fc42510b37b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - (experimental, off by default; enable with `web.sidecar`) Sidecar uses the trusted vendor CLI path for fresh and resumed sessions and explains missing binaries.
  
  Local overrides and PATH discovery remain supported. Missing-binary errors identify the setting to repair.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`4f85124`](https://github.com/en-dash-consulting/n-dx/commit/4f851249de2b55320a54b0f1b90952d5ba1f4c0c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar's change set card reads `PRD edits`, and the plan queue's lanes read `track`.
  
  The track label appears in the run-plan card, Live's Ready next, `n-dx work --plan-queue` output and help, the Ready next setting and the Sidecar lens instructions. JSON keys and the plan-queue schema are unchanged.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`777dc18`](https://github.com/en-dash-consulting/n-dx/commit/777dc18d271a2754a70f6a1e06b759651297101d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar (experimental, off by default; enable with `web.sidecar`) can propose edits to an existing item.
  
  A new `propose_item_edit` card shows each changed field before and after, covering the title, description, done-when, tags and priority. The operator can change the proposed values, and only Approve writes them, through rex's `edit_item`. The Describe lens now uses this card for tightened done-when wording.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`1b209fd`](https://github.com/en-dash-consulting/n-dx/commit/1b209fde13acc9eea834973fecff9e53f00d84bb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar (experimental, off by default; enable with `web.sidecar`) can change an item's status.
  
  A new `propose_status` card shows the current and proposed status and rex's own transition rule. Only Approve writes, through rex's `update_task_status` path and never forced, so completion still runs rex's checks, and a move rex refuses comes back as a failed card with rex's message. rex now exports `handleUpdateTaskStatus` and `validateTransition` for it.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`3fdea69`](https://github.com/en-dash-consulting/n-dx/commit/3fdea694b1df9413ee02c756e4f2c1c8764cee22) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar status cards (experimental, off by default; enable with `web.sidecar`) reject deletion and disclose completion effects before approval.
  
  Deletion is also rejected when approving older deletion cards. V2 completion cards now disclose enclosing-change completion, product amendment apply policy and test-gate holds before approval. Completion continues through Rex's existing policy.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`60656be`](https://github.com/en-dash-consulting/n-dx/commit/60656be55ccf6b148d4cf79579d15e13217c8aa3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A `Sidecar` status card (experimental, off by default; enable with `web.sidecar`) explains when a completion is recorded but held by a running hench session.
  
  After completion is approved, the card says the run applies it after its test gate, instead of "Status written."

- [#1009](https://github.com/en-dash-consulting/n-dx/pull/1009) [`ea349ab`](https://github.com/en-dash-consulting/n-dx/commit/ea349ab695d08d253c7d22b0039e768a45b14381) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The side stage links hide, and their gutters go, when the page body is narrower than 640 px, so the right link no longer covers content when the Sidecar drawer narrows the body.

- [#1012](https://github.com/en-dash-consulting/n-dx/pull/1012) [`2b40afe`](https://github.com/en-dash-consulting/n-dx/commit/2b40afeafb0aba0f944863f7ccca1e15f3dc31c3) Thanks [@endash-shal](https://github.com/endash-shal)! - Start Working runs in one click. The button starts the run with the task's saved run settings; a task with none first has the project defaults the Prepare task modal would show saved on it as its `run` block, so the settings the run used are visible and editable afterwards. The ▾ arrow now opens the Prepare task modal directly instead of a menu. The run-mode picker governs the click and is named on it ("Start working · until done"). If the defaults cannot be saved, or someone else saved settings on the task in between, nothing starts and the reason stays on the button.

- [#1012](https://github.com/en-dash-consulting/n-dx/pull/1012) [`d4079b9`](https://github.com/en-dash-consulting/n-dx/commit/d4079b9587443eea2045b763992205f5be6ab816) Thanks [@endash-shal](https://github.com/endash-shal)! - Start Working's one click no longer saves the project defaults on a task before the run is accepted. The defaults now travel with the execute as `saveRun: {run, version}`, and the server saves them (through the same path and version check as the Prepare task modal's Save) only after every execute gate has passed, right before it spawns — so a start refused because executions are paused, the task is already running, claimed by another worktree or blocked leaves the task's settings and the working tree unchanged, and a start that passes the gates but then fails to spawn has the saved block taken off again (best effort). A queued run carries `saveRun` through the hub's queue and saves it when it actually starts; a version conflict refuses the start with 409.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`f3ac44f`](https://github.com/en-dash-consulting/n-dx/commit/f3ac44f519f4c8f490dfad94a99a0b03e8f72392) Thanks [@endash-shal](https://github.com/endash-shal)! - Plain-language summaries are kept when the dashboard accepts analysis proposals, and the Plan capture bar drafts one in its Preview and saves it on Accept.
  
  `rex add` on a v2 tree takes `--summary` for a single description (it refuses several, and keeps the text as typed), and its JSON preview drafts one per change with `--summarize`, using the light-tier model. A draft that fails is left out. Review & Edit Proposals, used by analysis, batch import and Smart Add, passes each feature's and task's summary through to the accepted items.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`c77f9d1`](https://github.com/en-dash-consulting/n-dx/commit/c77f9d1def487e5f2b8749df3f43721ef95f525d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's `Start` and `Prepare task` controls save run settings for changes without child tasks.
  
  One-click Start saves project defaults before launching, while existing saved settings and version-conflict checks remain intact. Changes containing tasks direct you to save settings on those tasks.

- [#1009](https://github.com/en-dash-consulting/n-dx/pull/1009) [`6785ee7`](https://github.com/en-dash-consulting/n-dx/commit/6785ee73553fd4f0d5df0ade2fc0e459adb458ca) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tasks rows and the Tune panels shrink with a main column the Sidecar drawer narrows. A row's tag list shrinks and wraps beside a title that shrinks from its own width, so the row's actions stay inside it; the Tune panel grids use `minmax(0, 1fr)` tracks.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`a736bfc`](https://github.com/en-dash-consulting/n-dx/commit/a736bfca2f5e8494b08a68c1a5828e62891073fb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - (experimental, off by default; enable with `web.sidecar`) Codex Sidecar broker calls reach operator cards on fresh and resumed turns.
  
  Only the Sidecar broker is authorized at the CLI layer. Read-only shell policy and credential isolation remain in effect.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`0343201`](https://github.com/en-dash-consulting/n-dx/commit/034320158ff96a8718f9580d827e860b6825ba23) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard tiles shrink to fit their content, and tiles with more to show keep their size, fade and "Open to see all".
  
  The Files tile draws roles as full-width bars. On Plan, Plan health and Specs to tighten sit side by side under Open changes, and Plan health shows its Check, Fix and Reshape buttons.

- [#1021](https://github.com/en-dash-consulting/n-dx/pull/1021) [`19d4637`](https://github.com/en-dash-consulting/n-dx/commit/19d4637176c678b2bd015268304a68c554b2b335) Thanks [@endash-shal](https://github.com/endash-shal)! - Plan's Open changes tile shows three changes and links to the full list, Tune's Spend tile shows a spend summary, and crowded tiles offer "Open to see all".
  
  The Spend summary gives the estimated total, the latest day, budget use and the top three places tokens went, and opens the full Token usage view. Row actions on Open changes appear on hover.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`c32fbda`](https://github.com/en-dash-consulting/n-dx/commit/c32fbdaa97af98358f522adff484d6b73fd525e4) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar transcript reads a tool call's Failed or Done state from the result's error flag. A failed Codex command now reads Failed, and a successful call whose output starts with `[error] ` reads Done. Older transcripts without the flag still fall back to the `[error] ` prefix.

- [#1013](https://github.com/en-dash-consulting/n-dx/pull/1013) [`7ac5b95`](https://github.com/en-dash-consulting/n-dx/commit/7ac5b951c882ad66ba4aa3791c4fd928b3cea822) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The trust strip's visible line always shows how many PRD items carry saved run settings, even when three config files come first. `GET /api/trust` gains a `prdRunBlocks` count and a `prdRunBlocksPath`, the directory that holds them. The strip leaves that path out of the named sources and shows it with its count under Details. The strip is capped at a third of the viewport less the top nav and bottom bar, and the restrictions sentence moved under Details so the collapsed line fits two lines.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`5fa7dfa`](https://github.com/en-dash-consulting/n-dx/commit/5fa7dfa8e911adba826d8b0c6e91db1562357815) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On a v2 tree, the `Change tree` view, Up Next and the search type filter use change, task and subtask labels.
  
  These replace epic and feature labels. The dashboard glossary defines Change, Task, Subtask, Inbox and "Runs as one task". A v1 tree reads as before.

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`85a2dc5`](https://github.com/en-dash-consulting/n-dx/commit/85a2dc5338206c650ebbfdd2535f4b66310178cf) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On a v2 tree the top nav, page title, browser tab title, guide, settings overlay and stage sections say "Change tree" for the PRD view instead of "Tasks".

- [#998](https://github.com/en-dash-consulting/n-dx/pull/998) [`937b581`](https://github.com/en-dash-consulting/n-dx/commit/937b58110d8bec12972b55837e35d7529e2e5bbd) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The `dashboard` withholds run controls and refuses settings or launches for held Inbox work, closed changes, containers and v2 subtasks.
  
  Action needed: Place held work from the Inbox, reopen closed changes when appropriate, and start or configure a subtask through its parent task.
  
  Empty-product Inbox work, placed task-less changes, explicit deferred tasks and v1 tasks/subtasks retain their execution behavior. Saved model pins and transactional version checks remain intact.

- [#1009](https://github.com/en-dash-consulting/n-dx/pull/1009) [`4d6354c`](https://github.com/en-dash-consulting/n-dx/commit/4d6354ce9f6826db00d7f4c3ba0b75f0edab151c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tune's workflow suggestion actions wrap, so the Dismiss button stays inside its card instead of being clipped.
- Updated dependencies [[`eb59a53`](https://github.com/en-dash-consulting/n-dx/commit/eb59a5322c32639fdc5b9c11f964d004592d5461), [`ab81666`](https://github.com/en-dash-consulting/n-dx/commit/ab81666a7198577f0d7ad48ac08986d7ef49a850), [`ae73cd2`](https://github.com/en-dash-consulting/n-dx/commit/ae73cd212bcb64ab4667f2702fbf3446348a9ba9), [`6bd923f`](https://github.com/en-dash-consulting/n-dx/commit/6bd923f35c889904e6a5caac4258857490d2f3db), [`d6b1896`](https://github.com/en-dash-consulting/n-dx/commit/d6b1896792ae0aa5af95c1d940debbf084b5fbc3), [`627f8f4`](https://github.com/en-dash-consulting/n-dx/commit/627f8f4b3158facdd176cae7d562eab8bcd9f776), [`5e1246b`](https://github.com/en-dash-consulting/n-dx/commit/5e1246b96ba207d5b1626b001524f393d7a64411), [`499490c`](https://github.com/en-dash-consulting/n-dx/commit/499490c85cb9ac06f319eb688049f7c4a97ee487), [`a6de03b`](https://github.com/en-dash-consulting/n-dx/commit/a6de03b2be31b0f40f1f15e78ce9d6f72107258d), [`994117a`](https://github.com/en-dash-consulting/n-dx/commit/994117acc6ae59d1aabb6d6349770fce25f6a39f), [`85945fa`](https://github.com/en-dash-consulting/n-dx/commit/85945fa14d4b2d0ff0a835cb8c48998a7d5e328d), [`d007823`](https://github.com/en-dash-consulting/n-dx/commit/d0078230c7ada1b710f97e4cf8b7620ce5888a11), [`913d868`](https://github.com/en-dash-consulting/n-dx/commit/913d86826ac5929e9dbcb40173f93fc42510b37b), [`1b209fd`](https://github.com/en-dash-consulting/n-dx/commit/1b209fde13acc9eea834973fecff9e53f00d84bb), [`f3ac44f`](https://github.com/en-dash-consulting/n-dx/commit/f3ac44f519f4c8f490dfad94a99a0b03e8f72392), [`62ec0da`](https://github.com/en-dash-consulting/n-dx/commit/62ec0dab7a8cb18fa8306412dbb4a7b07c49e890), [`c32fbda`](https://github.com/en-dash-consulting/n-dx/commit/c32fbdaa97af98358f522adff484d6b73fd525e4), [`9bde7d5`](https://github.com/en-dash-consulting/n-dx/commit/9bde7d58dfe64816d4407fb8f809b7be23b59114)]:
  - @n-dx/rex@0.10.4
  - @n-dx/llm-client@0.10.4
  - @n-dx/sourcevision@0.10.4

## 0.10.3

### Patch Changes

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`8ecedbe`](https://github.com/en-dash-consulting/n-dx/commit/8ecedbe58e29f3b776fd2abf78ad36a72fdc4d41) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex add --area=<id|slug>` suggests placement among one area's capabilities and the constraints binding it. The area view's "+ Change in this area" uses it: the capture offers only that area's targets, Add & place writes the change already placed, and with nothing chosen it lands in the Inbox.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`19e1378`](https://github.com/en-dash-consulting/n-dx/commit/19e13780a04237188df9135ec5b3213ca489d20a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Plan's product area map now counts every open change on an area: one that adds a capability under it or amends the area itself, as well as those on its capabilities. The server works the count out per area.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`482825c`](https://github.com/en-dash-consulting/n-dx/commit/482825ca61bf1a4354ae1867cc9fe2435d52e667) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A shipped but unapplied change no longer counts as open on Plan's area map, the area view's Moving now, the Open changes area chip or the Product page total, so each count matches the rows Open changes lists for that area.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`dc7c024`](https://github.com/en-dash-consulting/n-dx/commit/dc7c0248f9989e63e7eacafb621445e2f99aab30) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's area view, `/product/area/<slug>`, is documented: how to open it, its spec map sized by criteria, the four cards, selecting a capability and "+ Change in this area". Its read uses rex's `--area` placement filter and `suggestPlacements`.

- [#942](https://github.com/en-dash-consulting/n-dx/pull/942) [`cfdc67c`](https://github.com/en-dash-consulting/n-dx/commit/cfdc67c6c577a9543d3aebee17ebb36b5d544fc9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Auth and key messages put the vendor CLI login first, point at `ndx config credentials.<vendor>` for a key, never suggest a key as a command-line value, and say that storing a key does not switch modes. A refused interpreter `--helper` prints one line.
  
  Soft freeze: message text only. No key, flag, exit code or MCP tool changes.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`a38853c`](https://github.com/en-dash-consulting/n-dx/commit/a38853c57f654025ec200ca2be0d5fc4312544b5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A capability page lists the Inbox changes held for placement that amend or touch it, such as the draft its own spec edit makes, under "Waiting in the Inbox" with a link to each. `GET /api/rex/product/capability/:id` carries them as `inboxChanges`; they stay out of `openChanges` and the Product total.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`5e1ac18`](https://github.com/en-dash-consulting/n-dx/commit/5e1ac18ea0275428526d68c242435b609389a665) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A v2 change reads In progress while any of its tasks or subtasks has started, not only when the change itself has. `ndx work` records the start on the task, so a running change used to show as Proposed in Changes, Product and Plan's lifecycle strip.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`6f1b90a`](https://github.com/en-dash-consulting/n-dx/commit/6f1b90afc44693d83c1ae0630c7ca589a0cf8a55) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Settings › Commands keeps its tab in the URL: `/command-reference` settles on `/commands/reference`, tab clicks push history entries, and a reload or Back reopens the same tab.

- [#992](https://github.com/en-dash-consulting/n-dx/pull/992) [`cc0e8b2`](https://github.com/en-dash-consulting/n-dx/commit/cc0e8b27bb8d9cb93b25d5624cb2b52f6eded390) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard's concurrency slider sends its PUT once, when a drag ends. Under preact/compat, which the dashboard loads, its `onChange` had become an `input` listener, so every step of a drag sent a PUT and disabled the slider mid-drag.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`c2174eb`](https://github.com/en-dash-consulting/n-dx/commit/c2174eb79742ec3745b94fdfc30a79604928339f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A caller aborting an external call (a stopped Sidecar turn) no longer marks its connection unavailable or drops its client.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`2028e89`](https://github.com/en-dash-consulting/n-dx/commit/2028e891305cee5c0c2f35e01a967dd9da87f329) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A connection credential kept after Remove is bound to the server it was stored for and is not sent to a different server declared under the same id.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`664654e`](https://github.com/en-dash-consulting/n-dx/commit/664654e083a48a3906446179f104596d072c8e24) Thanks [@ryrykeith](https://github.com/ryrykeith)! - OAuth connections sign in with n-dx's client ID metadata document (https://docs.n-dx.dev/oauth/client.json) where the authorization server supports it, so servers without dynamic client registration (CAOS) work; registration stays the fallback. Every sign-in returns to the fixed loopback callback `/oauth/callback`, which the hub relays to the project its state names; the `iss` response parameter is checked. A connection's `oauth.clientMetadataUrl` or `oauth.clientId` overrides the client, and a server profile's `oauth` block chooses the scopes asked for (CAOS: read scopes, plus write scopes while a write tool or tracker sync rule is on).

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`3f86d19`](https://github.com/en-dash-consulting/n-dx/commit/3f86d19bd60d18d32606765af080391445f77d70) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A connection's OAuth sign-in works with authorization servers that offer client ID metadata documents instead of dynamic client registration (CAOS): n-dx identifies itself as https://docs.n-dx.dev/oauth/client.json (published by this change) and returns to a fixed loopback `/oauth/callback`, which the hub relays to the right project without reading any credential. A connection can override the client with `oauth.clientMetadataUrl` or a pre-registered `oauth.clientId`. A server profile can name OAuth scopes; the CAOS profile asks only for read scopes unless a write tool or a sync rule needs more.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`60ffd68`](https://github.com/en-dash-consulting/n-dx/commit/60ffd68e8b82b2fb7eb2a661cd78cd8b32f7be8e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Editing a tool policy, profile, field hints or label in Settings no longer closes the connection or aborts a call in flight on it.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`3584ca9`](https://github.com/en-dash-consulting/n-dx/commit/3584ca98cf9c49e8350e39c1867c0c70ee4f8c67) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Settings > Project > Connections decides a connection's "sign in" or "sign in again" badge from a structured field on the connection row, so a token connection whose stored token was refused reads "sign in again", and the badge no longer depends on the server's reason wording.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`d4a909a`](https://github.com/en-dash-consulting/n-dx/commit/d4a909a69e44682235f417b87777eadfbc7826b2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - External MCP tools carry a read/write class and a run/ask/never policy, with per-tool overrides in a connection's config.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`6048b9c`](https://github.com/en-dash-consulting/n-dx/commit/6048b9c4f5d53cd883ba0025dcbc4f984b9e8ae7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Settings > Connections no longer waits the connect timeout on every load while a connection's server hangs; a failed connection is not retried inside its retry interval.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`6315a41`](https://github.com/en-dash-consulting/n-dx/commit/6315a419d41166ae1a4caac39f519ed665de814d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Settings > Project > Connections manages the Sidecar's MCP servers while `web.sidecar` is on: add an HTTP or stdio server with auth none, a token or OAuth, test it, remove it, change each discovered tool's class and policy, pick a server profile and see its validation, and set each tracker sync rule to off, dry-run or on. Writes go only to `.n-dx.local.json`; a typed token goes straight into the credential store and is never returned.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17) Thanks [@endash-shal](https://github.com/endash-shal)! - Integrate agent containment with tracked-local configuration checks, protected-config restoration and extension sidecars. Endpoint changes in committed local config invalidate trust; extension sidecars never receive hub browser-session credentials.

- [#984](https://github.com/en-dash-consulting/n-dx/pull/984) [`a1f8c38`](https://github.com/en-dash-consulting/n-dx/commit/a1f8c38c9cb36811b1ddf1bc59bb1ad90b328d6a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Credential store review nits: the landing page re-enables Initialize after a failed Google key store; the Claude scrub warning is Claude-only and no longer names GitHub tokens; a refused Windows credential-CLI spawn prints one line; `ndx config credentials --import` without a terminal exits 1 when a different stored key blocks a vendor.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`61a54a3`](https://github.com/en-dash-consulting/n-dx/commit/61a54a3fd1958375e2d2749001aea0f1329be578) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard's reorganize panel now shows the server's refusal text instead of "Apply failed (409)", and the reorganize and prune branch-guard refusals say the dashboard cannot override the guard, naming the terminal command that can.

- [#942](https://github.com/en-dash-consulting/n-dx/pull/942) [`d9cd523`](https://github.com/en-dash-consulting/n-dx/commit/d9cd523d706f3955cbe3afffe10abc068a84eec9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard footer reports api-key auth from the same decision as the vendor cards, so a key held only in the credential store counts under `llm.claude.auth api`. The init wizard stores a Google key with `ndx config credentials.google --stdin` instead of putting it on the command line.
  
  Soft freeze: no CLI, config or MCP surface changes. With nothing in the credential store, the footer and the init wizard behave as before.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`b867958`](https://github.com/en-dash-consulting/n-dx/commit/b867958eaa61590ca55c8a58bd385841e5aba012) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A failed dashboard run's error now keeps the end of both stderr and stdout, so hench's stdout refusal is no longer hidden by a stderr warning on Live and the task card.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard routes that spawn from repository content (command triggers, run commands, hench execute and prep, rex analysis, the LLM probes) answer 403 with `hint: "ndx trust accept ."` while the repository's execution config is not accepted, and CLIs are always resolved from the server's own install. Side-effect GETs refuse foreign-site requests and `/api/commands/auth` is now a POST. Every response carries `nosniff`, `X-Frame-Options: DENY` and a Content-Security-Policy; `/data/*` serves only the known data files, confined to `.sourcevision/`. The hub spawns project servers from its own binary and forwards an untrusted `Origin` unchanged.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`dd33072`](https://github.com/en-dash-consulting/n-dx/commit/dd330723761b893924236b57770cf9ef27f078a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar Describe lens quotes each vague done-when check and gives the tightened wording in its reply, for the operator to apply with `rex update` or the item editor. It no longer sends tightened checks through `propose_prd_change`, which only adds items and left a duplicate.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`8067182`](https://github.com/en-dash-consulting/n-dx/commit/8067182451baa78357ef0c7e8edfc873d6029f1f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - An extension can declare one Sidecar drawer tab with `sidecarTab: { label, path }` in its manifest (needs a `sidecar`; `apiVersion` stays 1). With `?project=<id>`, `GET /api/hub/extensions` adds `tab: { label, url } | null` to each entry. Earlier releases list an extension that uses the field as invalid, so set `ndxVersion` to this release or later.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`24484aa`](https://github.com/en-dash-consulting/n-dx/commit/24484aa4151dfacc6a0a2ecc64dac02d94262512) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A field hint can carry literal arguments for its read tool, and the built-in CAOS profile asks list_epics for its largest page (100), so a create card's epic picker is no longer limited to the first 25. A profile whose hint argument the read tool's input does not declare is refused, naming it.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`d84dbea`](https://github.com/en-dash-consulting/n-dx/commit/d84dbea303b556aaf934404bf144e0d28fc062f1) Thanks [@endash-shal](https://github.com/endash-shal)! - Guard MCP and dashboard bulk PRD rewrites on feature branches, and use caller-supplied file evidence for migration placement and capability specs. Correct Live task selection and Start now navigation, stack dashboard notices, preserve top bar context, and update the v2 docs and Analysis guide.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`a9c55b0`](https://github.com/en-dash-consulting/n-dx/commit/a9c55b066b061b08fe862bdf987d44e2bc421246) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Placement mode's proposed-capability block no longer picks up the waiting-card +N marker's absolute positioning.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17) Thanks [@endash-shal](https://github.com/endash-shal)! - Raise the default `hench.maxTurns` from 50 to 200. The cap now also bounds Claude CLI sessions, where 50 cut off ordinary tasks; the named templates keep their own values.

- [#907](https://github.com/en-dash-consulting/n-dx/pull/907) [`6bc4351`](https://github.com/en-dash-consulting/n-dx/commit/6bc43510c7b90d8dc082ee5a699c4431c6dd2a7d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - New `ndx work --plan-queue [--format=json]` suggests which ready tasks of a v2 PRD can run side by side, using fixed rules and no model call. It groups up to 3 light- or standard-tier tasks of one change into a lane, in dependency order, and prints the command that runs the lane. Every command targets the current checkout, so lane 1 runs here and each later lane must run in its own worktree (lane 1 too, while a run is live in this worktree): the summary and each such lane say so, and the JSON marks those lanes `ownWorktree: true`. Lanes offered together come from changes whose `touches` do not overlap, and a change with no `touches` runs alone. Tasks tagged `review-critical`, `migration` or `cross-package` are left out. The plan never offers more lanes than `guard.maxConcurrentProcesses` minus the runs active now, counted in every worktree of the repository. Every ready task is listed once, in a lane or left out, with a one-line reason. The command only prints: it starts no run, claims no task and writes no file.
  
  A new experimental toggle, `hench.readyNext` (off by default), replaces the Up next list on Live with Ready next, which shows each lane's command, the own-worktree note on every lane after the first, and the reasons for every task in or out. Each task title opens the task, as Up next items do.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`d2b79c3`](https://github.com/en-dash-consulting/n-dx/commit/d2b79c3a83eaeb73f4b46486f0ced7f2f385b7ae) Thanks [@ryrykeith](https://github.com/ryrykeith)! - hench finds the PRD on a project moved to the `.ndx/` layout when its config still holds the legacy default `rexDir: ".rex"`: `ndx work --task`, `--resolve` and `--plan-queue` follow the layout's rex dir, while a deliberate value still wins. `ndx migrate-layout` rewrites a legacy-default `rexDir` and verifies it; the dashboard shows the layout's rex dir as the field's default.

- [#907](https://github.com/en-dash-consulting/n-dx/pull/907) [`8bff582`](https://github.com/en-dash-consulting/n-dx/commit/8bff582e801e99c91823a6077927309125e8d19b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - New `hench runs diagnose <run-id> [--format=json]` explains why a run did not complete, using fixed rules and no model call. It names the class (test-gate-new, test-gate-preexisting, completion-held, review-blocked, claim-lost, budget-timeout, vendor-transient, no-changes or unclassified), the evidence behind it, the ranked next actions, and the attempt number out of 2. A run counts as completion-held when its completion was not applied (a completion that was applied or bypassed is not a hold), when it was a gate-only retry, or when the completion gate refused on uncommitted work. That refusal outranks every rule but a lost claim, and its first action is to commit or discard the uncommitted paths, then verify. claim-lost covers only a claim taken by another worktree. A read-only refusal (the forked attempt made no edits and the task re-ran cold) never sets the class; it is one evidence line on the class the retry's own record gives. test-gate-preexisting means the gate failed only in files the run did not change: with no baseline run, it says the failure is in tests the run did not edit and was not checked on main, never that it predates the run, and its only action is to run the failing tests on main. An absolute path in the test gate's failure digest is read relative to the run's worktree, so it matches the file the run changed. A file the digest names both package-relative and repo-relative is listed once in the summary and evidence, by its repo-relative path. On the second failed attempt it no longer suggests a re-run. Runs that end in any status other than completed store this verdict as `diagnosis` on the run record. The verdict's one-line summary becomes the task's `failureReason` when it has none, or when its current one is an earlier run's verdict, so the next brief names the latest cause; a reason a person or the agent wrote is kept.
  
  A new experimental toggle, `hench.runVerdict` (off by default), adds a verdict banner at the top of a task's detail panel, above the description, when its latest run did not complete. The banner shows the class as a readable label (for example "Failure in tests the run did not edit"), the summary, the first next action and the attempt number.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`ff58ff2`](https://github.com/en-dash-consulting/n-dx/commit/ff58ff2fcf464a1cab7e40c499a534d3c9e454ae) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub issues frame keys for extension drawer tabs (`POST /api/hub/extensions/:name/frame`) and serves `/x/<name>/~f/<key>/` with a sandboxing Content-Security-Policy and no Referer; a key works only on its own extension's paths and is dropped on disable, removal or hub restart.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e934190`](https://github.com/en-dash-consulting/n-dx/commit/e934190a5fe921630418cf5c20454f84835665d3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A drawer tab's scripts can read their own sidecar: on a frame-keyed request with `Origin: null` the hub adds `Access-Control-Allow-Origin: null` and `Vary: Origin` (never credentials) and answers the preflight itself, so an extension needs no CORS code to work in a tab.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub no longer spawns a binary recorded in an older `hub.json`. On start it drops each record's saved `ndxBin`, rewrites the registry, and spawns every project server from its own entry; a server such a record left running is replaced rather than adopted.

- [#953](https://github.com/en-dash-consulting/n-dx/pull/953) [`158f1dd`](https://github.com/en-dash-consulting/n-dx/commit/158f1dd23a0952ecbf322a8601e80cbf76c5b29a) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub home page tells an uninitialized project from a set-up one: its card offers a single Initialize action instead of Start working and Open dashboard. Initialize runs the setup wizard's own `ndx init` route from the card, under an overlay showing the current step; on success the card turns into the normal one without a reload, and on failure it shows the error with a Retry.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`0da19fe`](https://github.com/en-dash-consulting/n-dx/commit/0da19fecbed7e3437e185e38f51ff3f12b77e805) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub session drawer page is 88 KB instead of 545 KB: it imports the Sidecar
  hooks and drawer through a narrow barrel, so it no longer bundles zod, the
  loader or the dashboard's top nav.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e73ff8a`](https://github.com/en-dash-consulting/n-dx/commit/e73ff8a585a879955edd40c5c42fddfcb8f5918c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A project server hosting the hub session no longer gives up its host lock on shutdown while a hub turn is still writing the session: it refuses new hub requests, interrupts the turn and releases the lock once the turn settles (at most 5 s, else the next host takes over after exit).

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`ca44099`](https://github.com/en-dash-consulting/n-dx/commit/ca440998dd9fcd64665e34ba44e3a3cbca375be9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A hub session request, or WebSocket upgrade, that a host refuses for
  `web.sidecar` is retried on the next healthy host instead of answering the
  client 403. The body is buffered up to 1 MiB so it can be replayed; a larger
  one is refused with 413.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`601a8c3`](https://github.com/en-dash-consulting/n-dx/commit/601a8c34a8b68bcbdacb24fec670bf9cfb122131) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub session skips a project whose web.sidecar is off and moves to one that has it on; with none on, it answers a refusal naming web.sidecar.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`ef8700f`](https://github.com/en-dash-consulting/n-dx/commit/ef8700fd7d4cfebcfd29d874d8862af5d0c35989) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Hub session spend goes to `<ndx home>/hub/usage.jsonl` instead of the hosting project's usage ledger, and the hub home shows its total.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2aab084`](https://github.com/en-dash-consulting/n-dx/commit/2aab0847b780317392d6ea47035af87914f6c882) Thanks [@endash-shal](https://github.com/endash-shal)! - Hub-mounted extensions open in a browser again when the per-user token is on. A navigation to `/x/<name>/` without a credential gets the hub's own sign-in page, which asks `POST /api/hub/mounts/<name>` for a keyed mount (`/x/<name>/~<key>/`) and moves there; the key in the path admits that one sidecar's pages, scripts, styles, mutations and WebSockets, and nothing else. Extension pages never get the hub's session script. The keyed mount is announced in `X-Ndx-Base-Path` and, at launch, `NDX_BASE_PATH`, which graview-face now uses as its base. The preview server's sign-in page also parses again: a regex in its script had lost its backslash to the template literal.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`d4aa86f`](https://github.com/en-dash-consulting/n-dx/commit/d4aa86f338fd67ca240a74f55b5aca7a4364dc64) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub session now saves a snapshot's Δ fingerprints only after the turn that carried it completes, so a signed-out or stopped turn no longer hides changes from the next one.

- [#971](https://github.com/en-dash-consulting/n-dx/pull/971) [`c51f03f`](https://github.com/en-dash-consulting/n-dx/commit/c51f03fa4b6a39592fe57a5fc19b0b93dc2d02b0) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start` names a server older than itself instead of printing a URL with no sign-in link. `/api/hub/health` reports the hub's build (`build: { version, sourceHash }`), and `ndx start` warns when a reused hub runs another build. A source-linked install also warns before spawning when `packages/web/dist` is older than its source (a `pnpm dev` watch build does not count as stale). A missing nonce route now reads "the server is older than this ndx" with a fix that works: `pnpm --filter "@n-dx/web..." build` comes first when the `dist/` on disk is stale, because a restart alone would spawn it again, and the restart names the server's own commands (`--here`, `--preview`, `ndx web`). `ndx start status` in a directory with no recorded registration says this user's hub is running and names the command that registers it, rather than "No background server recorded" and "Port 3117 is in use by another process".

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`ad316ce`](https://github.com/en-dash-consulting/n-dx/commit/ad316ce86affc10a946d873c3a3463ac952d1f50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Inbox empty state names the project's CLI through the CLI-name helper instead of a hardcoded `ndx work`.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`7b964d4`](https://github.com/en-dash-consulting/n-dx/commit/7b964d4c4aaeea78589bfe4ce63d0e1989bc7f27) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Inbox rows show the change's age, its top suggestion's score beside the strength chip, and Place with Sidecar while `web.sidecar` is on. The Inbox count and list follow rex's rule (every open change with `needsPlacement`, including on a tree with no capability yet), matching `get_prd_status`, and the empty state says a held change cannot close and `ndx work` skips its tasks until it is placed.

- [#984](https://github.com/en-dash-consulting/n-dx/pull/984) [`bde174f`](https://github.com/en-dash-consulting/n-dx/commit/bde174f31e44a73474f102bba7b633d399c892eb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's setup wizard reports a Google key it could not store. When `ndx config credentials.google --stdin` fails after init, the wizard shows why and how to store the key (`ndx config credentials.google`) and stays on the page instead of redirecting. The message never contains the key. A successful store behaves as before.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`c516b7d`](https://github.com/en-dash-consulting/n-dx/commit/c516b7ddc95c8e66bd657772bfe3bd65c4d08022) Thanks [@ryrykeith](https://github.com/ryrykeith)! - propose_link and the item links routes accept a change's display id (CH-142) as well as its UUID.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`f5c8c0a`](https://github.com/en-dash-consulting/n-dx/commit/f5c8c0ae7e84740dde94851f4f73e77905a66c2a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Live's Hench slots tile has a stepper that sets the runtime concurrency override through `/api/hench/throttle`. `GET /api/ws/health` is documented as a server probe no dashboard view reads.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`1874369`](https://github.com/en-dash-consulting/n-dx/commit/18743694c32650c13593ab0671778ebae70240f9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Live lists Tracker activity while Sidecar is on and a tracker connection is set: each sync's item, event, call and result, a card's Approve (runs its call once with your edits) and Dismiss, and "sign in again" for a revoked connection.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`6fdc51a`](https://github.com/en-dash-consulting/n-dx/commit/6fdc51a11bd947fc3cca6db9df21a15d734f8ba9) Thanks [@endash-shal](https://github.com/endash-shal)! - Printed and opened dashboard URLs, MCP registration lines, `NDX_HUB_URL` and graview's hub endpoint now use `http://127.0.0.1:<port>` instead of `http://localhost:<port>`. The hub and project servers bind only `127.0.0.1`, and `localhost` may resolve to `[::1]` first, where another local account could listen on the same port and receive the sign-in nonce or the token. Re-register HTTP MCP clients with the `127.0.0.1` URL.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`c3f2890`](https://github.com/en-dash-consulting/n-dx/commit/c3f2890665a93ca1f839ff2be367be76e5be2f86) Thanks [@endash-shal](https://github.com/endash-shal)! - Wait for the full analysis to be accepted before the manual analyze flow leaves the Analysis page, so navigation cannot cancel its start request.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`98d7af6`](https://github.com/en-dash-consulting/n-dx/commit/98d7af68cb7e0b93e341cf8068df11c06b1fd281) Thanks [@endash-shal](https://github.com/endash-shal)! - Remove a manual flow's fixture directory even when its dashboard failed to start.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`7164c2e`](https://github.com/en-dash-consulting/n-dx/commit/7164c2edb6bcd78314e510c81de676a6c9980fbd) Thanks [@endash-shal](https://github.com/endash-shal)! - Take manual flow git baselines immediately before starting the agent, so fixture setup commits cannot satisfy the agent-commit assertion.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`ef609cd`](https://github.com/en-dash-consulting/n-dx/commit/ef609cd0da43997004aaacde525d01adea1a8307) Thanks [@endash-shal](https://github.com/endash-shal)! - The manual suite's CLI precondition resolves vendor binaries without a shell, so Windows runs no longer print DEP0190.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`23c56ac`](https://github.com/en-dash-consulting/n-dx/commit/23c56ac0dcb60322bd065a3cda0c654fd1672439) Thanks [@endash-shal](https://github.com/endash-shal)! - Snapshot workspace run IDs before each manual flow starts, so its Live task waiter cannot open a prior leg's completed run. Report malformed run lists and bounded wait failures explicitly.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`d20b14e`](https://github.com/en-dash-consulting/n-dx/commit/d20b14edf1237173842c7178da786d526ae24af3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A malformed escape in a `/product/place/<id>` address no longer throws; it names no change.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`453a780`](https://github.com/en-dash-consulting/n-dx/commit/453a78098d42133e23402664560f6944931d5135) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Choosing a placement target whose criteria must be read now clears the previous target's criteria edits at once, and Place stays disabled until the read lands, so an amendment never carries another target's criteria.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`5315b4e`](https://github.com/en-dash-consulting/n-dx/commit/5315b4e11e668d7333e894cd8bbfb586129b0b94) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A refused approval of an edited Sidecar placement card re-reads the dry-run line, so Place no longer repeats the 409 on a stale "Applies cleanly". When the card's own spec moved, the card says to raise a new one.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`307ee83`](https://github.com/en-dash-consulting/n-dx/commit/307ee835e5fb504360140fc9b61ac83b513bad38) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Rex's new `suggestPlacements` ranks many changes against one tree, building the tree index, placement nodes, open amenders and node keywords once. The area read and `GET /api/rex/changes/placements` use it, so an area with 60 Inbox changes answers in about 50 ms of ranking instead of growing with Inbox × tree.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`232ae93`](https://github.com/en-dash-consulting/n-dx/commit/232ae937ff030d36f653ba5ad7cbb0c5df925b1e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Placement mode is documented: where it starts, the area-level and zoomed openings, candidate cards, touches versus amends with the dry run, Nothing fits, Place & next and add another, keys and drafts.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`597c8da`](https://github.com/en-dash-consulting/n-dx/commit/597c8dad786883a46d60017d018a832c4f9cccee) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Plan lays out the Product map, Inbox, Open changes and Validation as tiles. The PRD tree is the Tree tab of Open changes, and each tile opens full-screen in place or through Open ↗. The docs and the in-app guide describe the new layout.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`6964973`](https://github.com/en-dash-consulting/n-dx/commit/69649738a729197cc775b7ac4b3a6b67f0f742f6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Plan gains a lifecycle strip, a product area map and an open-changes glance; the strip and the glance read `GET /api/rex/changes/summary`, and the area map reads `GET /api/rex/product`. Change rows carry a criteria gap and an open-blocker count. The dashboard docs and the in-app guide explain each strip stage, including what makes a change Ready.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`934527f`](https://github.com/en-dash-consulting/n-dx/commit/934527f210f57710738080c3ed3f6b337c8f901e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Plan gains a Plan health tile (check lights with Check, Fix and Reshape) in place of the Validation preview, and a Specs to tighten tile that links each spec gap to its filtered list. A change awaiting apply can be applied from its detail panel, previewed first.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`3340ad5`](https://github.com/en-dash-consulting/n-dx/commit/3340ad5ebe88a87b346a0c177d293ff642f8ccaa) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Document Plan's easier navigation to pending changes: the map's open-change badges, the Open changes `?area=` filter, the lifecycle strip's links and hints, and the map key. The in-app guide's Plan entry says the same.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`6ad002a`](https://github.com/en-dash-consulting/n-dx/commit/6ad002afc68dd0582a229a22f3c36f9247bafdc6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Plan's lifecycle strip says when an Inbox change is also counted in a stage. On a tree with no live capability nothing can be held, so `GET /api/rex/changes/summary` carries `inboxInStage` and the strip notes it beside the Inbox count; nothing shows when it is zero.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`641a93b`](https://github.com/en-dash-consulting/n-dx/commit/641a93b48a8dc1a54e16da7c7eee4ab02cf08ff0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The PRD Graph draws a v2 tree as changes and their tasks, one indent apart, with a "Changes only" view and shapes from the change layer. A merge links to the items its `N-DX-Item` trailers name, read by git's trailer parser. v1 projects render as before.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`0b3e173`](https://github.com/en-dash-consulting/n-dx/commit/0b3e17370430671fcf014f379534e3046eff49c9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Product page's Open changes total counts a change that adds a capability under an area or removes an area, matching the Plan area map.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`c5eeb43`](https://github.com/en-dash-consulting/n-dx/commit/c5eeb4363905ccd2c76e887345d4368b0d2bb72d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Requirements is a tab of the Product page, beside Map. Plan no longer lists it; `/requirements` still resolves, opening that tab, and on a v1 project shows the requirements view alone.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`a18de95`](https://github.com/en-dash-consulting/n-dx/commit/a18de952f314153ab4a04eb353ab4b60eb702f66) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex change inbox [--format=json]` lists every open change awaiting placement, oldest first: id, title, intent, age in days and the placement rules' top 5 candidates with scores and reasons. On a v1 PRD it answers "not applicable" and exits 0. A new change now records `createdAt` in its `state.yaml` row; a change recorded before that reads its age from `lastModified`. `GET /api/rex/changes/placements` rows carry the same `createdAt` and `ageDays` on their `change`.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`79ad886`](https://github.com/en-dash-consulting/n-dx/commit/79ad88697a378d559e39fa4768ebcb14bf9553d8) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Taking back a touches is rex's `recordUnplacement`: `POST /api/rex/changes/:id/unplace` refuses a cancelled change (`change-not-open`) and a target the change does not touch (`not-touched`), and runs the v2 rules, as a placement does.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`406be68`](https://github.com/en-dash-consulting/n-dx/commit/406be68f562d7bbbd85eb7a5e910acf2fdef1885) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Rex's placement suggestion carries the change's `createdAt` and `ageDays`, and the dashboard's placement route reads them instead of copying rex's age rule, so the Inbox age and `rex change inbox` cannot drift.

- [#972](https://github.com/en-dash-consulting/n-dx/pull/972) [`bf3f309`](https://github.com/en-dash-consulting/n-dx/commit/bf3f309c2a68d5c9c86fc9b3856a6f5e4e92af9c) Thanks [@endash-shal](https://github.com/endash-shal)! - Servers are no longer killed by the global `cli.timeoutMs`: `ndx start`, `web`, `dev`, `mcp`, the stdio MCP servers `.mcp.json` registers (`rex mcp`, `sv mcp`), `sv serve`, `graview serve` and `graview mcp` run until stopped unless `cli.timeouts.<command>` names a limit. `ndx graview serve` used to die at the global limit (five hours on this repo) because the timeout keyed only on `graview`. The subcommand is the first word that is not a flag or a flag's value, so `ndx rex -q mcp .` and `ndx rex --format json mcp .` count as the server too. The dashboard's copy of the rules (`GET /api/cli/timeouts`, the limit it puts on the analyze, plan and add it spawns, and a Sidecar `run_command`) follows core's order, lists `mcp` with the servers and applies the same server subcommands, so `ndx graview serve` or `ndx sv serve` run from the dashboard are not cut off either.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17) Thanks [@endash-shal](https://github.com/endash-shal)! - Document `hench.maxCostUsdPerRun`, `hench.maxCostUsdPerDay` and `hench.guard.sessionTimeout` in `ndx config` help and `hench config`, and expose them in the dashboard's hench settings.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`286973d`](https://github.com/en-dash-consulting/n-dx/commit/286973dd0c146bf7553b6807d2eb911f2e55f3f2) Thanks [@endash-shal](https://github.com/endash-shal)! - The happy-click settings spec now asserts the saved Ask toggle reads enabled, instead of only that the feature registry lists its key.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`59f8bb5`](https://github.com/en-dash-consulting/n-dx/commit/59f8bb54a2b22d65f854d3fe517969497e74aa50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Every side effect a Sidecar session can cause now goes through one broker, the new `ndx-sidecar` MCP server, which the dashboard serves at `/api/sidecar/sessions/:id/mcp` while a turn runs. Its tools are `run_command`, `start_work`, `propose_prd_change`, `place_change_card`, `propose_edit`, `github_read`, `draft_github_post`, `migration_decision` and `ledger_append`. Each write tool waits on a permission card: it is announced as a `sidecar:card` WebSocket message, listed at `GET …/cards`, and decided at `POST …/cards/:cardId`. It goes through without a card only when it matches the Sidecar allow-list (`GET`/`DELETE /api/sidecar/allow-list`). Only an exact command and GitHub reads can be allow-listed; work, resets, pushes, edits, PRD writes, placements, migration decisions and posts never can. An approved call is recorded but not carried out yet. The Claude CLI now spawns with `--tools Read,Grep,Glob`, `--setting-sources ""`, the broker as its only MCP server (`--strict-mcp-config`) and `--allowed-tools mcp__ndx-sidecar`, so the operator's own `permissions.allow` rules never decide a call. Codex spawns in a read-only sandbox that never asks for approval. llm-client's `ClaudeTurnFlags` gains `tools` and `settingSources`.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`6007d12`](https://github.com/en-dash-consulting/n-dx/commit/6007d12641198276fab76d3f5abcccf86ad47896) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Task pages offer "Ask Sidecar" and capability and zone pages offer "Explain in Sidecar", each opening the drawer with that item attached and its lens chosen; opening the drawer on the Inbox page picks the Place lens, with the change selected in the triage queue attached. The buttons appear only while `web.sidecar` is on.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`a386fd5`](https://github.com/en-dash-consulting/n-dx/commit/a386fd552cfe0861c40b5f730c29c2468efaf8df) Thanks [@ryrykeith](https://github.com/ryrykeith)! - An "Ask Sidecar" or "Explain in Sidecar" attachment now lasts only while the page shows the item it was asked from. Opening another task, capability or zone in the same view attaches that item with its default lens. The Zones page now reports the zone open in its slideout, so Sidecar attaches it.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`9bf175e`](https://github.com/en-dash-consulting/n-dx/commit/9bf175e02e152c44d1366fbe955cf793b9a73372) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Sidecar session's MCP config no longer carries the dashboard token, which the session's own Read tool could open. It carries a per-session broker key (`X-Ndx-Sidecar-Key`) that the request gate accepts only on a `POST` to that session's `/api/sidecar/sessions/<id>/mcp`.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`f39df51`](https://github.com/en-dash-consulting/n-dx/commit/f39df5196292ee1846d381517f2152cf0a307047) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A worktree Sidecar session's broker offers the tools of the operator's connections under `<id>__<tool>`: reads run at once, writes wait on an external-call card that is never allow-listable, and a server that is down reads "connection unavailable" while the session keeps working.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`6b85fc5`](https://github.com/en-dash-consulting/n-dx/commit/6b85fc5b41832cd420a2c99a3efed3f7ab98baa5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Sidecar `ndx` command that writes `.sourcevision/` (analyze, ci, refresh, and any other command whose declared effects say so) now takes the dashboard's `.sourcevision` write lock. It is refused while the dashboard's analyze, CI or refresh runs, and they are refused while it runs.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`9e99597`](https://github.com/en-dash-consulting/n-dx/commit/9e995974527693f7552e5bd87fc9ce6375aa7c37) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar Diagnose branch lens now has a packet (8k cap) built from branch health for an attached worktree: branch, base, PR, stack position and containment, ahead/behind, each failing check with its class, evidence and a capped log tail, and each predicted conflict with its class and the card its fix goes on. A Workspaces card's Ask Sidecar attaches the worktree (a new `worktree` item, ref = workspace key) and opens the drawer on Diagnose branch. The lens is unavailable while `git.branchHealth` is off, or with no worktree attached. The broker now carries out `github_read` (`pr`, or `check` on a base branch, which decides "failing on main") and `draft_github_post` (`comment` or `review`, posted under the operator's gh login only on Approve; Copy and Discard post nothing). `web.sidecarGithubReads` is the one allowance for GitHub reads: on, a read runs without a card; off, each read raises a network-read card, whose "Allow GitHub reads for this project" turns it on. A `github_read` rule on the Sidecar allow-list is no longer honoured.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`daf18c9`](https://github.com/en-dash-consulting/n-dx/commit/daf18c9a70db2e72281c09c0af58bc5f0fca264a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar's Diagnose run lens reads the task's newest run in any worktree of the repository and names the worktree it came from. A run still recorded as running whose process is gone is no longer told to the model as still running: it is classified, and the packet says that ending it from Live records the end. `hench runs diagnose` classifies such an orphaned run the way ending it would record it, without saving anything.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`74448a5`](https://github.com/en-dash-consulting/n-dx/commit/74448a57fe95f07ee33336d38ec649d3d67d5373) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar composer is one rounded card holding a "Lens: <name>" pill, a transparent 14px textarea, a keyboard hint and an accent-filled Send (Stop gets a secondary style). Keys and behaviour are unchanged.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`ef48918`](https://github.com/en-dash-consulting/n-dx/commit/ef48918d29b8f9d2638fe923c49c0b37e8d930c0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar drawer shows an extension's page as a tab: Sidecar first, then one tab per extension in the hub's order, only when a hub lists any. A tab asks for its frame key on first open, loads in an iframe sandboxed with `allow-scripts allow-forms allow-popups allow-downloads`, shows "Starting …", the hub's 503 with its log file, or "Expired · Reload", and offers a pop-out link. Switching tabs keeps the conversation, the composer and the frame.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`4cd7d38`](https://github.com/en-dash-consulting/n-dx/commit/4cd7d380375fd396c42e6309022d83f8d9988469) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar drawer's header reads as a segmented Chat / extension-tab control with a pill Sessions toggle and a 32px close button. The agent bar's vendor and model pickers are the dashboard's styled selects with visible "Agent" and "Model" labels, and show readable names ("Claude", "Opus 5.5") while their values stay the ids.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`3584ca9`](https://github.com/en-dash-consulting/n-dx/commit/3584ca98cf9c49e8350e39c1867c0c70ee4f8c67) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar transcript tool lines read as plain-language pills: a status dot, a readable name ("Run command", or "<connection> · create ticket" for an external tool) and a short status (running, waiting for you, done, failed). The raw tool name stays in the line's expanded details.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`47dc74c`](https://github.com/en-dash-consulting/n-dx/commit/47dc74cfca23e0288dbe17b8509a803f657105ad) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar drawer has a wide-mode toggle in its head: it widens the drawer to most of the viewport (960 px and up) and lifts the tool-result height cap. The choice is remembered per browser.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`6ade936`](https://github.com/en-dash-consulting/n-dx/commit/6ade93699652bcd8b969df739b5cfd290a60dc0e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the Sidecar drawer behind `web.sidecar`, which stays off by default. With it on, a top-nav Sidecar button (⌘J) docks a resizable drawer beside every page: a transcript that resumes from its cursor after a reload, a composer with Stop, an agent picker fed by `/api/llm/catalog`, and tool calls that expand to their raw input and result.
  
  - Permission cards are decided in order, oldest first, with an orange paused bar while the agent waits, ⌘↵ / ⌘⌫, a deny note sent to the agent, "Always allow" only where a call can be allow-listed, and a command card's effects from the command manifest with layout paths expanded. Ending a session withdraws its waiting cards, drawn as denied with "session ended". A top-nav badge counts waiting cards.
  - The drawer names a missing vendor CLI with its install command, and a signed-out one with its login command, which survives a reload.
  - Sessions take a target and can be renamed or re-lensed through `PATCH /api/sidecar/sessions/:id`; the lens packet now opens a session's first turn as well as a refreshed one. `GET /api/sidecar/lenses` lists each lens and whether it is available.
  - A sessions list shows each session's branch, lens, model, turns, cost and waiting cards, with Resume, Rename and End, for this worktree or all of them.
  - The drawer attaches the current page's item, including a task picked in the Tasks tree, and picks its lens; a lens that is not built yet shows "not available yet" and the session runs General.
  - Each finished turn writes a `sidecar` line, with its lens, to the dashboard usage ledger, and LLM Utilization shows Sidecar spend as its own bucket.
  
  Outside the flag: Claude tool results now reach hench runs as well as the Sidecar. The session driver turns each `tool_result` block on a Claude stream-json `user` line into its own event carrying the call's id, and hench records each result on the call it names without changing turns, completion or token totals. The dashboard's status dock drops the worktrees pill, and the uncommitted-files warning becomes an orange "N uncommitted" chip in the bottom bar that opens the same commit panel.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`268356d`](https://github.com/en-dash-consulting/n-dx/commit/268356d3aaf9a415568144c31303879c7ffe77f1) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar external-call card's fields use the agent bar's field style, with labels above them, and Approve and Deny are primary and secondary buttons. In Settings > Project > Connections, a connection that never signed in reads "sign in"; only one whose sign-in expired or was refused reads "sign in again".

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e051bb9`](https://github.com/en-dash-consulting/n-dx/commit/e051bb9ab168aaffa03ddf0a5d089a4512e5935f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - An external write's Sidecar card is a form drawn from the tool's input schema, prefilled with the agent's arguments and editable before Approve, with the connection and workspace host in its header, a read-only idempotency key, optional pickers from per-connection field hints, and a validation error's problems list.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`a6ef368`](https://github.com/en-dash-consulting/n-dx/commit/a6ef3687b5d9c644c5d102e27da1e1440edde6bc) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the Sidecar's first lenses and carry out its approved calls, all behind `web.sidecar`, which stays off by default.
  
  - An approved or allow-listed `run_command` runs as the workspace's Sidecar command job, shown in the job tray and on Live. The agent waits up to 60 s for it and gets the exit status and the output's last 80 lines (at most 8 KB, saying how much was cut), or hears that the command is still running as its job. A turn stopped while waiting answers at once and leaves the job running.
  - A `start_work` card shows the task's `ndx work --resolve` before approval; approval starts the run through the hench execute route and is refused at `guard.maxConcurrentProcesses`. `start_work` now takes the execute route's `options` instead of raw flags.
  - Sidecar planning ends in one editable change-set card. A `propose_prd_change` call is read against the PRD before its card is raised: each item's type and parent are resolved, an item that matches an existing one is flagged with the match, and on v2 the card says whether the change lands on its target or in the Inbox needing placement. The operator can edit each item's title, description and done-when. Approval writes the edited items in one transaction under the PRD lock, by the dashboard's own add and placement rules, and the tool result lists the ids written. A denied or withdrawn card writes nothing, and the card never applies a change. While a card waits, the Plan tree shows its items as dimmed "proposed" rows. The duplicate scan yields to the event loop between items, so a large card does not stall the dashboard.
  - Other approved tools report "recorded, not carried out yet" and name the batch that will carry them out.
  - Settings > Workflow gains a Sidecar section: the allow-list editor (work, reset and push shown locked and refused when added), mode (Ask; Auto locked), the worktree and hub context ceilings, the session idle window (`web.sidecarIdleMs`) and a GitHub reads toggle that nothing reads yet. Nothing is written until Save, and Save checks every staged command before writing any.
  - The Explain lens explains a product area, a capability or a sourcevision zone. A capability's packet lists each capability criterion as `met`, `not met` or `not verified` with its evidence, and on a v1 tree the packet says there is no product layer.
  - The Describe lens reads the Prepare modal's `ndx work --resolve` and `--dry-run`, started together and cancelled when the turn stops, and carries done-when checks, likely files and the tier with its reason. Its instructions flag vague criteria and propose tighter ones on a change-set card.
  
  Outside the flag: rex exports `findDuplicateItem`, the duplicate rule smart add already used, now shared with the change-set card. Smart add's matches are unchanged.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`91b289e`](https://github.com/en-dash-consulting/n-dx/commit/91b289e9968c8318ff062e3f8d330f35b96fbcd5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Decided Sidecar cards fold to one line (head and settled note) with a Details button that opens the body. Several decided cards collapse behind an "N decided" toggle, and pending cards stay first and open.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e99002b`](https://github.com/en-dash-consulting/n-dx/commit/e99002b6ff0144a18685719b45c5bf487d5af2b7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar's `github_read` of a check calls it "failing on main" only when the base is the repository's default branch; on any other base, such as a stacked PR's parent layer, the class is "failing on the base (<base>)". A `pr` read while `git.branchHealth` is off reads nothing and raises no card, as `GET /api/branch-health` already refuses.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`56f79cc`](https://github.com/en-dash-consulting/n-dx/commit/56f79cc1115e0abf38446cb4729e5f16c962f143) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Reading `web.sidecarGithubReads` from shared config checks the repository's trust with `isRepoRestricted`, the same decision the dashboard's trust gate makes. It no longer collects the PRD and run inventory on every branch-health or settings request.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e8abbbd`](https://github.com/en-dash-consulting/n-dx/commit/e8abbbd2175c9bdceb9ca71a5021724a5c6b4093) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A repository's own `.n-dx.json` can no longer turn off the Sidecar's network-read cards. `web.sidecarGithubReads: true` in the shared config (or a committed `.n-dx.local.json`) applies only once the checkout is trusted (`ndx trust accept .`): until then `github_read` raises a card, and neither the Diagnose branch packet nor `GET /api/branch-health` runs gh. The key is a `network-reads` trust finding and is in the trust digest. The user's own `.n-dx.local.json` always applies, and the dashboard now saves the setting there.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`b01d2d5`](https://github.com/en-dash-consulting/n-dx/commit/b01d2d5f3751ec0f44f75957bebb167338b5d295) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar Guide lens keeps each lane in a worktree of its own. A lane the queue planner marks `ownWorktree` says so in the Guide packet, on the run-plan card and under Ready next, in hench's wording, and choosing it from a card starts nothing. A work card refuses to start, and its preview warns, while a run is live in this checkout.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`b84f6d0`](https://github.com/en-dash-consulting/n-dx/commit/b84f6d01a3886003f1f8a0ec3ddc0eb2dce90ec9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar Guide lens now has a packet: the queue planner's plan (`ndx work --plan-queue`, read the way `GET /api/hench/plan-queue` reads it) with lanes, reasons, excluded tasks and active runs against the limit, capped at 6k. While `hench.readyNext` is off, `GET /api/sidecar/lenses` reports Guide unavailable, naming that toggle, and no planner is spawned. A new broker tool, `propose_run_plan`, raises a run-plan card of the planner's lanes with their exact `ndx work` commands; it can never be allow-listed. The card's Copy commands copies every lane command with no broker call. Its Start lane approves the card with a `lane` and has the Sidecar raise a work card for the lane's first task only; the lane's other tasks follow on later turns, one approved work card at a time. A work card now shows active runs against the run limit, and approving a start past it is refused with that reason.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`65df2de`](https://github.com/en-dash-consulting/n-dx/commit/65df2de305f0e69d152a94a5c60b5f63868089b0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub session drafts and never acts. It is offered only `run_command`, `draft_github_post`, a new `save_draft` and `ledger_append`; `start_work`, `propose_edit`, `propose_prd_change`, `place_change_card` and `migration_decision` are not offered to it. Its `run_command` takes a project and one of `ndx status`, `git worktree list` (also `--porcelain`) or `git status --short --branch`, each allow-listable per project; any other argv is refused without a card. A GitHub draft names its project and target and posts, on Approve only, under the operator's gh login with cwd at that project's repository root. `save_draft` saves a side-session prompt, restack plan or release checklist at a path shown and editable on its card, writes nothing before Approve, never overwrites a file and is never allow-listable.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`3884dc8`](https://github.com/en-dash-consulting/n-dx/commit/3884dc83b7d2b5ee1e54dd832e89cea26f106d72) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub session keeps its ledger in `<ndx home>/hub/ledger.jsonl` (new `decision-needed` type) and carries it on every turn, so its notes survive checkpoints, restarts and a new hub session. "Open in worktree sidecar" on a snapshot worktree hands the hub's latest question to that worktree's session as a `handoff` ledger entry and opens its drawer, and the snapshot shows each worktree session's latest unfinished and decision notes.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`6ac6a9f`](https://github.com/en-dash-consulting/n-dx/commit/6ac6a9fd71b1b841145b7a31d4c14dd7cdb8138b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub home docks the hub session. When the project server that would host it can run the hub lens (`web.sidecar` on), the header shows a "Hub session" toggle (⌘J) that opens a drawer beside the project cards. The drawer is a drawer-only dashboard page served through the hub at `/hub/session/drawer`, so the home page stays server-rendered. Its head reads "Hub session" with a purple "Hub · all projects" chip, how many snapshot items changed since your last turn, and the Hub lens. Its composer says "read-only · drafts" and meters the session's context against the hub ceiling (40k by default). Project servers answer `GET /api/sidecar/hub/lens` and `/drawer`; the host answers `/snapshot`, which reads the Δ count without moving the session's fingerprints.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`68f1dd7`](https://github.com/en-dash-consulting/n-dx/commit/68f1dd72c2b6122df674c1a193e078180e392c54) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Adds the hub-scope Sidecar session, still behind `web.sidecar`: one per machine, stored under `<ndx home>/hub/sidecar/` and hosted by a project server holding a host lock (pid and port). The hub serves it at `/hub/session/…`, HTTP and WebSocket, after its token check, forwarding to `/api/sidecar/hub/…` on the host, and moves to another healthy project when the host is unregistered or dies; the new host resumes the session from disk. Every turn opens with the hub snapshot rebuilt for it. The context ceiling is 40k unless `web.sidecarContextCeiling.hub` sets another. The session's Claude CLI gets no built-in tool and only the `ndx-sidecar` broker, whose calls carry out nothing yet. A Codex hub session is refused, because its read-only sandbox can still read repositories.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`347acef`](https://github.com/en-dash-consulting/n-dx/commit/347acefab94802fde4c0bad99938f3a68a2cb925) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Adds the hub snapshot builder for the coming hub Sidecar session: every registered project's PRD layout (v1 flagged "not migrated"), worktrees (branch, dirty count, ahead/behind, claim, latest run and its diagnosis class), active runs against the limit, the hub queue, open PRs (base, stack and containment, review, checks, mergeability, conflict classes) and pending changesets (major bumps and next-major mentions flagged), within 8,000 characters, with items changed since the last build marked Δ. Its input is read over the hub's HTTP API with the per-user token. New read route `GET /api/changesets` lists `.changeset/*.md` with each package's bump. `GET /api/status` now reports `rex.layout`, `GET /api/worktrees` each latest run's `diagnosisClass`, and `GET /api/branch-health` `githubReads`.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`a3342f7`](https://github.com/en-dash-consulting/n-dx/commit/a3342f7a780e84a35676ded62bbc2835ceebe72b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar sessions gain lens packets and a context ceiling, still behind `web.sidecar`. The Explain, Describe and Plan lenses each build a bounded, deterministic context packet in code (8k, 8k and 10k characters, every section stamped with its source and staleness). A turn that ends above `web.sidecarContextCeiling` (100k tokens for worktree sessions, 40k for the hub) checkpoints: the agent writes typed notes to the session ledger, and the next turn starts fresh from the packet, the ledger and the last two exchanges.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`408cbbc`](https://github.com/en-dash-consulting/n-dx/commit/408cbbc3c4092572b76b23f7a24749aaad4ea9aa) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar Markdown keeps a numbered list's starting number when a code fence splits it, and renders indented sub-bullets as list items instead of literal `- detail` text.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`9562a2d`](https://github.com/en-dash-consulting/n-dx/commit/9562a2dbb62d9c9ee460bd5f99b7d293f1e33e6a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar replies render Markdown (headings, lists, code, bold, italic, links) through a shared vnode renderer that the PR preview also uses; raw HTML shows as text.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`f266b20`](https://github.com/en-dash-consulting/n-dx/commit/f266b20becac5196100c9442625d1875c56b2578) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar drawer starts a new session on purpose: a New session button in the drawer head, at the top of the sessions list and in the ended-session bar opens a fresh session with the current agent, model and page attached. The session it leaves stays in the list and resumes.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`fe857f1`](https://github.com/en-dash-consulting/n-dx/commit/fe857f1c07d21df8676b894960256e59aef881a5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar Place lens drafts where an Inbox change belongs on a v2 PRD. Its packet carries the change, rex's top-5 shortlist with scores, strengths and reasons, each candidate's statement and capability criteria, the default relation and the rule that set it, and the open changes already amending a candidate. Without an attached change, or on a v1 tree, the lens is unavailable and says what it needs.
  
  `place_change_card` now carries out a placement. The card shows rex's dry run (the target's spec hash for an amends placement, or rex's refusal kind) and, on approval, writes through the same rex place and propose rules as the Inbox routes. A proposed capability or constraint is recorded on the change only, and reaches the product map when the change is applied. `POST /api/rex/changes/:id/placement/check` returns the same dry run and writes nothing.
  
  The placement card lets the operator review and edit before anything is written: the shortlist as radio rows with score, strength and reasons, a row to propose a new capability or constraint, a touches/amends toggle and, for amends, an editor for the statement and the criteria add, replace and remove. An edit re-checks through the placement check route, and Place stays disabled until the dry-run line for the edited placement is back. Approving sends the edit with the decision and the dry run the operator reviewed, and rex writes the edited placement. If its target, relation or spec hash moved since that check, or an edit that keeps the card's target and relation finds the spec changed since the card was raised, the approval is refused with 409 and nothing is written. Approving a card raised with a refusal writes nothing, even if rex would accept the placement now. Leave in Inbox and Deny write nothing. "Place with Sidecar" on the Inbox triage page and on a change awaiting placement attaches the change and opens the drawer on Place, and shows nothing while `web.sidecar` is off.
  
  Rex's `suggestPlacement` now returns `relationRule` and each candidate's `amendedBy`, and `GET /api/rex/changes/:id/placement` includes both.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`456dc8b`](https://github.com/en-dash-consulting/n-dx/commit/456dc8b042b9d7ab9f075e7600d55dfc1542d3a8) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A placement or proposal written through a Sidecar card now logs `decidedBy` (`sidecar:<session id>`), `approvedBy` (the operator, as the change's `lastModifiedBy`) and the agent's reasons on its `change_placed` or `change_proposed` entry; a Plan-lens change-set placement logs the first two. CLI, MCP and dashboard placements log what they did before.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`da55609`](https://github.com/en-dash-consulting/n-dx/commit/da556098000dd99f2f0b6f81343535ca4a852096) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar reaches Plan and Tune when `web.sidecar` is on: Plan with Sidecar on the capture bar, the area view as an area item with Plan in this area, Place with Sidecar in place of Draft with the model, Tighten with Sidecar and Describe in Sidecar, and Diagnose in Sidecar on Tune. One surface decides a placement at a time, and a waiting change-set card shows as ghost items in the tree, Open changes, map markers and the strip without changing any count. With the Sidecar off, Plan and Tune are unchanged. The entry points, the one-surface rule and ghost items are documented.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`c38e6d2`](https://github.com/en-dash-consulting/n-dx/commit/c38e6d2861e39b2c34be0e9ae2d9c6df4c720a2b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A refused Sidecar start now reports hench's refusal and its file list even when hench also printed a warning: the failure text and the execution log carry the end of stderr, then the end of stdout.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`b29c7b1`](https://github.com/en-dash-consulting/n-dx/commit/b29c7b111fa12a8ef8caad43a3805e7f0a0b30bb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `requireUnblocked` is a run option: `ndx work --resolve` lists `--require-unblocked` and reports it under `resolved`, and the dashboard's execute route passes it and refuses, naming the open blockers, a task whose blockers are not completed. A Sidecar run-plan lane step with `--require-unblocked` now starts from a work card carrying that option, and the work card preview lists the task's unfinished blockers.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`ac988d0`](https://github.com/en-dash-consulting/n-dx/commit/ac988d0b53bfd30de7a55728720ef0248213a0df) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A request to an extension sidecar that crashes while the hub revalidates its launch plan now starts it again, instead of answering 503 "the hub is shutting down". A sidecar stopped on purpose during that check stays stopped and answers 404, as a stop during a first launch does.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`9f83044`](https://github.com/en-dash-consulting/n-dx/commit/9f83044fc2f1b13d743642585e0f9f405f9fd615) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Sidecar run that fails after `start_work` said it started (hench refusing past the starting phase, or failing later) is now reported to the agent: the session's next turn opens with the run, its task, its exit code and the end of hench's output.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`953ec71`](https://github.com/en-dash-consulting/n-dx/commit/953ec71697c023f82e8625120094788ac1d9c1d0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A vendor session started without an explicit `env` now gets the parent environment filtered by `resolveVendorCliEnv` (with optional `envPolicy` and `llmConfig`), never the full `process.env`; `addTokenUsage` is exported. The web server gains a Sidecar session registry (not yet routed): sessions keyed by scope and worktree, persisted to `.hench/sidecar/index.json` so they resume by vendor id after a restart, forgetting the id after a 2-hour idle TTL, with JSONL transcripts in a self-ignoring directory.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`1520680`](https://github.com/en-dash-consulting/n-dx/commit/1520680897aac2c1f1e3638393868fe50b3b7ec0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar `start_work` refuses a task with an unfinished blocker unless the call passes `requireUnblocked: false`.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`b93a4db`](https://github.com/en-dash-consulting/n-dx/commit/b93a4dbc02616f55a7e0f0d0920a251d7505696d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Sidecar's `start_work` waits out a run's starting phase: a start hench refuses (dirty tree, missing task) comes back as failed with hench's message instead of "Started run", and a run that fails later revises its card to failed, so a run-plan lane reads open again.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`da2f23f`](https://github.com/en-dash-consulting/n-dx/commit/da2f23f525635655315503408c1aa53c498edef8) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A ready Sidecar extension tab offers Reload, which asks for a new frame key and reloads the page, so a tab whose key expired after loading no longer needs the drawer closed and reopened.

- [#901](https://github.com/en-dash-consulting/n-dx/pull/901) [`a545c96`](https://github.com/en-dash-consulting/n-dx/commit/a545c96e51ff6dd0200744f45c9ba787f8582d6f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar turns travel over HTTP: `POST /api/sidecar/sessions/:id/turns` answers `202` once the prompt is in the transcript, each appended frame is announced as a `sidecar:frames` WebSocket message with the session's cursor, and `GET …/frames?after=<cursor>` returns the frames, so a reloaded client resumes from the last cursor it rendered. Sessions can also be listed, created, interrupted and ended. Every `/api/sidecar` route refuses while the new `web.sidecar` feature flag (off by default) is off. A vendor session's turn now carries the whole reply in its assistant and completion events (`parseLine` takes a `textLimit`; hench keeps its 500-character summaries), and an interrupt escalates to a kill after 500 ms, so it stops a turn within 2 s. The process-table scan that finds the CLI's children has its own 1 s budget.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`f0bb098`](https://github.com/en-dash-consulting/n-dx/commit/f0bb0987751ca63b8b8d77ff839da1e448a2a7a0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Narrowing the Sidecar drawer out of wide mode follows the pointer, or one 20 px keyboard step from the shown width, instead of snapping to 640 px; wide mode ends once the width is back inside 360–640 px.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`1811a0d`](https://github.com/en-dash-consulting/n-dx/commit/1811a0d8417abc61db457f98235bbbce2d66a3f5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Sidecar work card counts live runs in every worktree of the repository and refuses a start at the limit, naming the runs that hold it. A run-plan lane reads "Work card raised" until its run starts.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e3ffcc3`](https://github.com/en-dash-consulting/n-dx/commit/e3ffcc391fca579363d329b5dfaac2b5cb91f0a0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Sidecar work card's title line shows `--require-unblocked` when the run will use it: the server puts the options start will use on the card, and the title is built from them.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`5fbe852`](https://github.com/en-dash-consulting/n-dx/commit/5fbe85262403018d315c77d85e8520dd91bc2264) Thanks [@endash-shal](https://github.com/endash-shal)! - The happy-click sweep closes the PRD status picker after each click and never presses its options, so a sweep cannot change a fixture task's status.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`679f72c`](https://github.com/en-dash-consulting/n-dx/commit/679f72cb3c6a8ef69ad90a7eb94ea775e23ce85d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Opening Tune no longer runs the vendor CLI. The Your tooling tile renders straight from config and the catalog, and reads only a cached credential verdict from the new `GET /api/commands/auth/cached`. The live check stays on Robot Wrangler's Re-check.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`9a5b110`](https://github.com/en-dash-consulting/n-dx/commit/9a5b110b45e759c92a9ddb38ceef8f2c1120484f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Tune "Your tooling" tile is marked `requiresServer`, so a static export omits it instead of showing "Could not read the project's LLM configuration."

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`23e58ef`](https://github.com/en-dash-consulting/n-dx/commit/23e58ef5da7b75c18689f72708375609a804f710) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tracker sync sends a CODEOWNERS owner as the tracker user id mapped in `trackerSync.reviewers`, never the raw GitHub handle; an unmapped handle becomes a card naming it.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`6591aeb`](https://github.com/en-dash-consulting/n-dx/commit/6591aeb8e0f97f849afad07176e113ea8b415ade) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Approving a tracker create card now links the change to the work item it created, so later move rules (run started, PR opened, PR merged) act on it. A link that cannot be written is named on the activity entry.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`3ed8c4d`](https://github.com/en-dash-consulting/n-dx/commit/3ed8c4d08b3a76724ccc8a5aabfddd35fd68715e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A rex item links to a tracker work item and the link shows. Link and Unlink on a task or change write the ref to a v2 item's `issues` or a v1 item's `links[]`; the link shows on the task, change and Live pages with the tracker's label from its server profile; the Sidecar's `propose_link` raises a link card, never allow-listed, that writes only on Approve. The v1 to v2 migration moves a v1 item's `links[]` into `issues`.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`4802078`](https://github.com/en-dash-consulting/n-dx/commit/4802078bbfd1c2378d49727bfe7c29e5c2bb9cd9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A tracker sync rule that is on but cannot read its event source (GitHub reads off, or gh failing) now leaves a record that `GET /api/tracker/activity` answers as `sources`, and clears it when the source reads again.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e6fed0a`](https://github.com/en-dash-consulting/n-dx/commit/e6fed0aa99ca27cbc779463387b5383f1d259f2a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tracker sync fills each move's workflow facts from their named source (reviewer from the profile default or CODEOWNERS, review link from the PR URL, delivery note from the release, blocked reason from the run diagnosis). A missing fact, or a feature the tracker's declared limits say a person must create, becomes a card naming it instead of a guessed call.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`7026107`](https://github.com/en-dash-consulting/n-dx/commit/702610753ae21620fc294a6f5e042759825a8b4e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tune gains two read-only tiles: Outcomes by tier (gate pass rate per vendor and tier over 30 days, from run records on this machine) and Your tooling (vendors, tier models, routes and review pairing, linking to Settings).

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`47d69d7`](https://github.com/en-dash-consulting/n-dx/commit/47d69d7d426917a650f32034a7f97ae85253f2c1) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Docs and the in-app guide describe the four-stage loop and Tune, and where Runs, Spend, Suggestions, Shipped, All Commands and Requirements now live.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`a08c885`](https://github.com/en-dash-consulting/n-dx/commit/a08c8851cc868a7a239ff55072961e827598b71c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tune's tiles are Runs (Execution Log tab, 8 columns by 2 rows), Spend, Suggestions (Optimization and Adaptive tabs) and Shipped. The Runs page drops its System status drawer; Live has the throttle and stop.
  
  Soft freeze: dashboard layout only. Every view keeps its id and route.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`7f4b19c`](https://github.com/en-dash-consulting/n-dx/commit/7f4b19c169b09298e5105e8daba15b44512177cc) Thanks [@endash-shal](https://github.com/endash-shal)! - The Work page's Up Next card no longer shows an empty badge where the item's type goes. It reads the type from the node the dashboard sends (`type` on v2, `level` on v1), and shows a placed change's display id beside it; an Inbox change shows its type and no blank slot.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`a41a7a2`](https://github.com/en-dash-consulting/n-dx/commit/a41a7a21a5f2d39b08e5b163bd47d2bfb859284b) Thanks [@endash-shal](https://github.com/endash-shal)! - On a v2 project, the dashboard's proposal accept routes (`POST /api/rex/proposals/accept` and `/accept-edited`) now create changes the way `rex analyze --accept` does. Each proposed task becomes an Inbox change that needs placement and keeps its criteria, tags, priority and source. Before, they were written as v1 epics, features and tasks that never reached the Inbox. On both the CLI and the dashboard, an oversized task's proposed subtasks (its LoE decomposition) now become tasks under its change instead of being dropped. A proposal that describes existing code is still not created on v2.
  
  On v2, `accept-edited` also answers with `changeCount` and `taskCount`. The proposal editor now passes each task's `source` and `decomposition` through to that route.
  
  rex now exports `changeInputsFromProposals`, `addProposedChanges` and the `ProposedWork` and `ProposedChangeInput` types.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`c9d31de`](https://github.com/en-dash-consulting/n-dx/commit/c9d31de348ac067418328632f1b12da450e7ff45) Thanks [@endash-shal](https://github.com/endash-shal)! - The proposal editor carries each task's status to accept-edited, so a completed (baseline) proposal accepted through Review & Edit on a v2 project creates no Inbox change, as Accept already did. On v2 both accept routes answer with `changeCount`, `taskCount` and `skippedCount`, so an accept where every proposal describes existing code says why nothing was added instead of returning a bare `addedCount: 0`.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`da7f88a`](https://github.com/en-dash-consulting/n-dx/commit/da7f88aadc29f92a69553a6d15b7e81a44230d4a) Thanks [@endash-shal](https://github.com/endash-shal)! - On a v2 project, the Add Subtask form in a task's detail panel no longer offers a priority. A v2 subtask carries none, and the server dropped the pick without saying so. On a v1 project the form still offers priority and the subtask keeps it.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`d297890`](https://github.com/en-dash-consulting/n-dx/commit/d29789088706744bf03f5439b60e57df71e40ce0) Thanks [@endash-shal](https://github.com/endash-shal)! - The PRD tree's inline "+" add form no longer offers or sends a priority for a subtask under a v2 task, matching the detail panel's Add Subtask form; both now read one rule, `childCarriesPriority`, beside `childTypeOf` in `shared/item-type.ts`. `POST /api/rex/items` answers 400 "A subtask does not carry priority" for a v2 subtask sent with a priority, as rex's add rule does, instead of 201 with the priority silently dropped.

- [#942](https://github.com/en-dash-consulting/n-dx/pull/942) [`fc0e78c`](https://github.com/en-dash-consulting/n-dx/commit/fc0e78cdb4fb656a4c4aa493b38a224447ebb807) Thanks [@ryrykeith](https://github.com/ryrykeith)! - New `llm.<vendor>.auth` setting (`cli`, `api` or `auto`, default `auto`)
  chooses which credential claude, codex and google get. `ndx config
  credentials.claude|codex|google` stores a vendor key in the per-user
  credential store. A stored key is used under `api` (and by google, which has
  no CLI login); under `auto` only a configured or exported key selects the API,
  so storing a key never moves a vendor off its CLI login. `cli` keeps the vendor
  key out of the CLI child. `ndx config credentials [dir]` prints each vendor's
  mode and key source, never a value. hench refuses `provider=api` under `auth
  cli`, or with no key it may use, before the run starts; `ndx work --resolve`
  reports `auth`. A project config's `llm.<vendor>.auth api` applies only once
  the repository is trusted.
  
  Soft freeze: `llm.<vendor>.auth` and `credentials.<vendor>` are new keys, and
  `--resolve` gains a top-level `auth` field. With no stored vendor key and no
  `auth` set, every mode choice and child environment is unchanged. The missing
  API key errors now name `ndx config credentials.<vendor>` and
  `llm.<vendor>.auth`. No MCP tool changes shape.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`1acc3d3`](https://github.com/en-dash-consulting/n-dx/commit/1acc3d3df1d28d561ac599ce40ae5436e07d705c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Leaving a capability in an area view behind the hub (`/p/<id>`) or on a worktree (`/w/<key>`) keeps that prefix in the address, so a reload no longer lands on the hub root.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`00b5b49`](https://github.com/en-dash-consulting/n-dx/commit/00b5b49abae50859f6370e75c985ad937da94dc0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A retired capability is never the area view's selection: one named in the address or retired while selected clears, and the area header no longer counts retired capabilities.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`f8c74bd`](https://github.com/en-dash-consulting/n-dx/commit/f8c74bd22fe4a0ffcd6e662ae9c969f289576267) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex validate --post-merge` now scans a v2 PRD (`product/` and `changes/`) instead of reporting nothing there: conflict markers, unparseable `state.yaml`, duplicate ids, `state.yaml` rows for items no file carries, and `blockedBy` refs to no id, display id or alias. `--repair` drops the orphaned rows (under the PRD lock) and the dangling refs.
  
  New `GET /api/branch-health` reports the addressed worktree's branch by fixed rules, with no model call: its base and where the base came from (the PR's base, else the upstream, else origin's default branch), commits ahead and behind, files `git merge-tree --write-tree` predicts will conflict with their stages, and whether each branch it stacks on is contained. The worktree, index and HEAD are never touched. When `web.sidecarGithubReads` is true and the request asks with `?github=1`, it also reads the PR with `gh pr view`, and gives each failing check the tail of its failed log and a class: behind-base, policy-test, codeql, touched-test, fork-no-ci or unclassified. Checks are classed on the whole log, though behind-base wording counts only on `##[error]` annotation lines and in the check name, and behind-base also follows the PR's `BEHIND` merge state and any stack layer not contained. A local-only answer, or one whose `gh pr view` fails, reuses the PR base an earlier GitHub read found (never for a branch gh reports has no PR), and a local-only answer says when it has not been read yet. A merge-tree timeout is reported as a timeout. With GitHub reads off, or gh missing, no gh command runs and the local facts still answer.
  
  Each predicted conflict is classified by fixed rules and carries a fix that a person runs; nothing is run or written for them:
  
  - `prd-children-table` (a v1 PRD `index.md` whose conflicts are all `## Children` rows): `git checkout --ours`, `rex validate --post-merge --repair`, `git add`, `rex validate`.
  - `prd-state` (a v2 `state.yaml` while the rex-state merge driver is unregistered): register the driver and redo that file's merge.
  - `duplicate-capture` (both sides added the same PRD item under different ids): keep the base's id, then `rex validate --post-merge --repair` prunes what still names the dropped id, `git add -u` stages it and `rex validate --post-merge` checks.
  - `allowlist-union` (both sides only added list entries: YAML `- ` items, quoted strings, one-line array rows or JSON array elements; never a lockfile, and an added code block or mapping is `source`): a unified diff holding both additions, this branch's first, with an entry both sides added listed once.
  - `generated` (a path in the new `web.generatedFiles` setting, `[{ paths, command }]`): take the base's copy, run the declared command, `git add`, after every other fix.
  - `source` (everything else): no fix; names the other local worktrees whose branch changed the same file (the card shows three and counts the rest). Each worktree's diff is kept server-wide by base and tip commit, so opening the board runs it once, not once per card.
  
  A new experimental toggle, `git.branchHealth` (off by default), adds a health strip to each Workspaces card that expands to the full status, listing each conflicted file with its class and fix: steps as copyable commands, diffs collapsed. The board reads local facts on open and asks GitHub only when a card is expanded. While the toggle is off the endpoint refuses with 403 and the cards are unchanged.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`aea1719`](https://github.com/en-dash-consulting/n-dx/commit/aea171997663b03f968fcb3c80444f4ac4ad47f2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A connection with `auth: "oauth"` signs in through the MCP SDK's OAuth flow (discovery, dynamic client registration, PKCE) and refreshes its token silently. The client registration and tokens are stored together as `connection:<id>` in the credential store, bound to the server URL. A revoked or unrefreshable token reads "needs sign-in" rather than failing the session.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`36e7735`](https://github.com/en-dash-consulting/n-dx/commit/36e773577a78e2135e46a439cf171b2c973b01cf) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A connection's unavailable reason no longer carries its stored token: a server error body that echoes the token reads as the token's fingerprint, secret-shaped text is redacted, the reason is capped at 300 characters, and it still names the HTTP status.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`b6875b5`](https://github.com/en-dash-consulting/n-dx/commit/b6875b56f22ca88f72402b60309d4ae052c068ce) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Settings > Project lists the Sidecar's connections with their state while `web.sidecar` is on, and signs OAuth connections in and out. The sign-in returns to the dashboard page, which finishes it through an authenticated route; `/api/connections` and its OAuth routes need the per-user token or a browser session and never return a token or code.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`a98d239`](https://github.com/en-dash-consulting/n-dx/commit/a98d239bb4e1d6f6a8e8b75c1dc922f2e22b37db) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A project server with web.sidecar off now answers a WebSocket upgrade to a hub session path (`/api/sidecar/hub/…`) with 403 and `x-ndx-feature-disabled: web.sidecar`, as its HTTP routes already did, so the hub moves the drawer's socket to a host that has the feature on. Other upgrade paths are unchanged.

- [#984](https://github.com/en-dash-consulting/n-dx/pull/984) [`e614cfb`](https://github.com/en-dash-consulting/n-dx/commit/e614cfbcf6e5e1ce9ed1093dddea87da07b6e2d2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's CLI probe (`<binary> --version` behind the model catalog) now runs with the environment the vendor's runs get under the project's own `llm.<vendor>.auth`, so a token such as `ANTHROPIC_AUTH_TOKEN` is no longer dropped when auth is unset. It falls back to the CLI login only when `api` has no usable key.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2e5bb10`](https://github.com/en-dash-consulting/n-dx/commit/2e5bb10d7c4e4acf0b9cd25aa23d419148447abe) Thanks [@endash-shal](https://github.com/endash-shal)! - The LLM catalog drops an unused `restricted` parameter and a "CLI not verified" readiness state nothing produced; the architecture docs now say what actually protects it (the trusted-config clamp on `cli_path`, and a model list that always calls the vendor's own URL).

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`f82130e`](https://github.com/en-dash-consulting/n-dx/commit/f82130e1d1552764f20c8db102dc758f0ad11a4c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - An address with a malformed capability id, such as `/product/area/<slug>/capability/%E0`, now opens the area instead of throwing during render and blanking the dashboard.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard, hub and preview servers no longer set or accept an `ndx_token` cookie. A browser signs in by exchanging a single-use, 60-second nonce from the URL `ndx start` prints for a session credential of its own, kept in `sessionStorage` and sent as `X-Ndx-Token`; WebSocket handshakes carry a single-use ticket from `POST /api/auth/ws-ticket`. Sessions live in the memory of the server that minted them and end on restart. A navigation without a credential gets the page shell, which shows how to sign in; other tabs of the same origin hand a new tab their session. The per-user token in headers is unchanged for the CLI and MCP clients.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`e32b5b1`](https://github.com/en-dash-consulting/n-dx/commit/e32b5b1c264d97a0704a58291d60ab16d93d178e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A failed dashboard run's error keeps hench's refusal header when the dirty-file list is long.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`e54d54c`](https://github.com/en-dash-consulting/n-dx/commit/e54d54cf8fe5eb37a43e21b18e78a91364ff3e60) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A connection can name a server profile: data that adds per-tool field hints and a tracker mapping. CAOS ships built in; users add their own under `<ndx home>/tracker-profiles/`. A profile that does not fit the server's tools is reported on the connection and not used.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`b37827c`](https://github.com/en-dash-consulting/n-dx/commit/b37827c501cc3489d46e1bb2584b138f4d2c1131) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Connection service for the Sidecar: n-dx connects to MCP servers the operator declares under `connections` in `.n-dx.local.json` (streamable HTTP or stdio; auth none, a token stored as `connection:<id>`, or an OAuth sign-in) and lists their tools as `<id>.<tool>`. A `connections` block in the tracked `.n-dx.json` is ignored with a warning.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`7a6db4f`](https://github.com/en-dash-consulting/n-dx/commit/7a6db4fcdcb642aa20d8c45331d603dd88f00bf0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar's Diagnose run lens now has a packet: the attached task's newest run, with the run classifier's verdict and ranked actions, the gate digest's end, the review's unrepaired findings and the last events. Each action is offered through the broker card that carries it out, and at attempt 2 of 2 the lens offers no re-run or `--fresh`. With no task attached the lens is unavailable and says it needs a task to diagnose.

- [#961](https://github.com/en-dash-consulting/n-dx/pull/961) [`5e5adad`](https://github.com/en-dash-consulting/n-dx/commit/5e5adadad35efd9703aa01706182bb71a6ae1911) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Sidecar replies keep single line breaks inside a paragraph again.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`5318d0a`](https://github.com/en-dash-consulting/n-dx/commit/5318d0a6c865d8b4dd03b8e86be40ae9531df491) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Sidecar run-plan lane whose work card was denied or withdrawn shows Start lane again; it asks the agent for a new work card for the lane's first task without a new plan card.

- [#984](https://github.com/en-dash-consulting/n-dx/pull/984) [`10d7de8`](https://github.com/en-dash-consulting/n-dx/commit/10d7de85894165d300b68a1ca76521c861715cd3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Test-only: every web test file now loads `preact/compat`, as the shipped viewer does, so a test's DOM events no longer depend on which file ran before it in a shared worker. The add-item form blur test and the throttle slider test send the events the viewer listens for. No runtime change.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`a80b5e0`](https://github.com/en-dash-consulting/n-dx/commit/a80b5e0780fa7b7609192e8685fc4e80ed422760) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tracker sync collects its events at each tick: a hench run starting a linked task, a PR carrying an `N-DX-Item` trailer opened or merged (gh, only while `web.sidecarGithubReads` is on), a release tag for a change's `shippedIn`, and a task's second failed run in a row. Each source keeps a cursor in `<henchDir>/sidecar/tracker-cursors.json`, so an event is queued once and a restarted server does not queue it again; the first read is a baseline. The hub ticks every project whose `.n-dx.local.json` sets a rule not off, on its server's start and every five minutes, through its proxy with the per-user token, and skips a server that is not healthy.

- [#930](https://github.com/en-dash-consulting/n-dx/pull/930) [`f1391bb`](https://github.com/en-dash-consulting/n-dx/commit/f1391bbd8aa881a649b6e71a078a2dc8499b7f70) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tracker sync rules turn ndx events into tracker calls through a connection, configured under `trackerSync` in `.n-dx.local.json`. Every rule is off until set; dry-run logs the would-be call; on makes moves automatically while creation and blocked raise cards. Each call carries `ndx:<project>:<rexId>:<event>`, duplicates are confirmed with a read, and a refusal is logged with its problems and never retried. `POST /api/tracker/sync/tick` (per-user token only) runs the queued events; `GET /api/tracker/activity` lists the log.
- Updated dependencies [[`8ecedbe`](https://github.com/en-dash-consulting/n-dx/commit/8ecedbe58e29f3b776fd2abf78ad36a72fdc4d41), [`4406726`](https://github.com/en-dash-consulting/n-dx/commit/44067261f2bbedd0aaf89485ea24c0376bf686ff), [`dc7c024`](https://github.com/en-dash-consulting/n-dx/commit/dc7c0248f9989e63e7eacafb621445e2f99aab30), [`cfdc67c`](https://github.com/en-dash-consulting/n-dx/commit/cfdc67c6c577a9543d3aebee17ebb36b5d544fc9), [`ad6d15d`](https://github.com/en-dash-consulting/n-dx/commit/ad6d15d964cd561a8d5c97125bccd13da76c8282), [`7c74c0a`](https://github.com/en-dash-consulting/n-dx/commit/7c74c0a4ae2177c037764e88250d7da8314cceca), [`1d9d42e`](https://github.com/en-dash-consulting/n-dx/commit/1d9d42eb9e68c697b185755779f1514ce123957c), [`d273ed6`](https://github.com/en-dash-consulting/n-dx/commit/d273ed6b775380b42f73fe33461ec1bb7f1e6478), [`487b1f3`](https://github.com/en-dash-consulting/n-dx/commit/487b1f3110e6d483aa954d321ad7e2620f4cc0f5), [`9819d06`](https://github.com/en-dash-consulting/n-dx/commit/9819d060a940af8643aca5a75d56e8f33c282df8), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`00aab92`](https://github.com/en-dash-consulting/n-dx/commit/00aab92e5851881e9a1cc41c9a9da64cc8561b7b), [`a1f8c38`](https://github.com/en-dash-consulting/n-dx/commit/a1f8c38c9cb36811b1ddf1bc59bb1ad90b328d6a), [`0e1a76c`](https://github.com/en-dash-consulting/n-dx/commit/0e1a76cec65ce9dc65ec3631ff8a2e5357ac6e30), [`18f73d1`](https://github.com/en-dash-consulting/n-dx/commit/18f73d1adc74e9270393af01bd8bc08a00d58f31), [`aa24773`](https://github.com/en-dash-consulting/n-dx/commit/aa24773abcc085275cf75aee2969695500b437cf), [`c5c0b9c`](https://github.com/en-dash-consulting/n-dx/commit/c5c0b9cff96aa682dda19250eb1f9a65385ea1e0), [`4e5e18d`](https://github.com/en-dash-consulting/n-dx/commit/4e5e18d93dd694139980d4b3fc0b40c14bd4e014), [`56a78de`](https://github.com/en-dash-consulting/n-dx/commit/56a78de119d40fa2086328b0d9f05009799dd450), [`d84dbea`](https://github.com/en-dash-consulting/n-dx/commit/d84dbea303b556aaf934404bf144e0d28fc062f1), [`c01c1cf`](https://github.com/en-dash-consulting/n-dx/commit/c01c1cfdd02e8140e19816cdc7532a14536b691d), [`b3c5865`](https://github.com/en-dash-consulting/n-dx/commit/b3c5865f723aa1987ee06af7c14cbccb97598f6f), [`1e15277`](https://github.com/en-dash-consulting/n-dx/commit/1e1527735f30c89049e26dffcc3eefc30e713019), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`55a18e2`](https://github.com/en-dash-consulting/n-dx/commit/55a18e2b1656c6740d9b95545fb8c7fcce2c34c0), [`6a55e1a`](https://github.com/en-dash-consulting/n-dx/commit/6a55e1a43e84cf20ea863dcf62b7edda1e28e576), [`2947bf6`](https://github.com/en-dash-consulting/n-dx/commit/2947bf691d9891c3bd7e2f2a2e7098f6fd2681f2), [`d64421e`](https://github.com/en-dash-consulting/n-dx/commit/d64421ee2a37c0a5102d62e36c60f944b118b57a), [`aa502f6`](https://github.com/en-dash-consulting/n-dx/commit/aa502f6a067ba2cb77c8922f875ba01b235e526c), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`a3c5b79`](https://github.com/en-dash-consulting/n-dx/commit/a3c5b794609a0801e17abc192c1531399a1bc3dd), [`db72033`](https://github.com/en-dash-consulting/n-dx/commit/db72033f058aac14532464b04e01bc80c07fdc15), [`dde29c1`](https://github.com/en-dash-consulting/n-dx/commit/dde29c1a66fe3bce7df4c005aed56337c46e0df0), [`307ee83`](https://github.com/en-dash-consulting/n-dx/commit/307ee835e5fb504360140fc9b61ac83b513bad38), [`934527f`](https://github.com/en-dash-consulting/n-dx/commit/934527f210f57710738080c3ed3f6b337c8f901e), [`52d8828`](https://github.com/en-dash-consulting/n-dx/commit/52d8828fb29763f8796e006685332bc88bd8ae8a), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`3f117d9`](https://github.com/en-dash-consulting/n-dx/commit/3f117d98366e4ece1bcf0ecc2d24008050b9c347), [`b69d079`](https://github.com/en-dash-consulting/n-dx/commit/b69d079f2af71df65b3e00a5ff18a6db0dec7b6c), [`a18de95`](https://github.com/en-dash-consulting/n-dx/commit/a18de952f314153ab4a04eb353ab4b60eb702f66), [`43ae12a`](https://github.com/en-dash-consulting/n-dx/commit/43ae12ac004803765dd6a4871f81d80805367a52), [`7b964d4`](https://github.com/en-dash-consulting/n-dx/commit/7b964d4c4aaeea78589bfe4ce63d0e1989bc7f27), [`79ad886`](https://github.com/en-dash-consulting/n-dx/commit/79ad88697a378d559e39fa4768ebcb14bf9553d8), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`406be68`](https://github.com/en-dash-consulting/n-dx/commit/406be68f562d7bbbd85eb7a5e910acf2fdef1885), [`91d5b85`](https://github.com/en-dash-consulting/n-dx/commit/91d5b857fd888e1fbf76a6f995aba0662be65493), [`c772b48`](https://github.com/en-dash-consulting/n-dx/commit/c772b48ded3518371cf488f2f2c2806ba4bd0c59), [`59f8bb5`](https://github.com/en-dash-consulting/n-dx/commit/59f8bb54a2b22d65f854d3fe517969497e74aa50), [`6ade936`](https://github.com/en-dash-consulting/n-dx/commit/6ade93699652bcd8b969df739b5cfd290a60dc0e), [`a6ef368`](https://github.com/en-dash-consulting/n-dx/commit/a6ef3687b5d9c644c5d102e27da1e1440edde6bc), [`e8abbbd`](https://github.com/en-dash-consulting/n-dx/commit/e8abbbd2175c9bdceb9ca71a5021724a5c6b4093), [`fe857f1`](https://github.com/en-dash-consulting/n-dx/commit/fe857f1c07d21df8676b894960256e59aef881a5), [`953ec71`](https://github.com/en-dash-consulting/n-dx/commit/953ec71697c023f82e8625120094788ac1d9c1d0), [`a545c96`](https://github.com/en-dash-consulting/n-dx/commit/a545c96e51ff6dd0200744f45c9ba787f8582d6f), [`f1b41dc`](https://github.com/en-dash-consulting/n-dx/commit/f1b41dc389d50716424882a1c4a034375806ed87), [`a3f71a2`](https://github.com/en-dash-consulting/n-dx/commit/a3f71a23b25cce01f42c3731eea2c209d61fbd0d), [`3ef2ef4`](https://github.com/en-dash-consulting/n-dx/commit/3ef2ef4b41a95aa4e92df368a2ecd9cc040f2eaa), [`3ed8c4d`](https://github.com/en-dash-consulting/n-dx/commit/3ed8c4d08b3a76724ccc8a5aabfddd35fd68715e), [`b640e8c`](https://github.com/en-dash-consulting/n-dx/commit/b640e8c1a54a04101455b9fedec4dd9665294c25), [`2b16b07`](https://github.com/en-dash-consulting/n-dx/commit/2b16b07f012e848dbcfeecd67a86fb2d0d53ca17), [`83e32ac`](https://github.com/en-dash-consulting/n-dx/commit/83e32ace9dd3a612243015dfc1085b5b20ec0368), [`674186a`](https://github.com/en-dash-consulting/n-dx/commit/674186a290c5d6ff3068a6ba59e06ef18dac769e), [`e4f700c`](https://github.com/en-dash-consulting/n-dx/commit/e4f700cbf516f7c44724f8d0fda59e026bfac7b6), [`a41a7a2`](https://github.com/en-dash-consulting/n-dx/commit/a41a7a21a5f2d39b08e5b163bd47d2bfb859284b), [`401166b`](https://github.com/en-dash-consulting/n-dx/commit/401166bce49465f4de5e7a9f9049a4f553b68b5f), [`fc0e78c`](https://github.com/en-dash-consulting/n-dx/commit/fc0e78cdb4fb656a4c4aa493b38a224447ebb807), [`f8c74bd`](https://github.com/en-dash-consulting/n-dx/commit/f8c74bd22fe4a0ffcd6e662ae9c969f289576267)]:
  - @n-dx/rex@0.10.3
  - @n-dx/llm-client@0.10.3
  - @n-dx/sourcevision@0.10.3

## 0.10.2

### Patch Changes

- [#908](https://github.com/en-dash-consulting/n-dx/pull/908) [`e022268`](https://github.com/en-dash-consulting/n-dx/commit/e022268d6a518617edd5edd48e672b6228434f25) Thanks [@endash-shal](https://github.com/endash-shal)! - Test: pin the Ask route passing the v2 merge rule to the refinement parser, so a v2 project is never offered a merge that absorbs an amending change.

- [#931](https://github.com/en-dash-consulting/n-dx/pull/931) [`0e063a2`](https://github.com/en-dash-consulting/n-dx/commit/0e063a218622a3aa856c3d854fbbcc2552459b81) Thanks [@endash-shal](https://github.com/endash-shal)! - Escalate a task that keeps failing to a stronger vendor or model before it is
  skipped as stuck. New settings, off by default: `hench.escalation.enabled`
  (false), `hench.escalation.after` (2 consecutive failures), `hench.escalation.vendor`,
  an optional `hench.escalation.model`, and `hench.escalation.maxAttempts` (1).
  When a task reaches `after` failures (or `hench.maxFailedAttempts`, if lower),
  its next attempt runs on the escalation vendor and model through the per-task
  settings resolution, on that vendor's CLI when it has one; an explicit
  `--model` flag and a task's saved `run` block keep their precedence. Hench
  logs one line per escalated attempt, records `escalation` on the run record,
  and `ndx work --resolve` reports it. Only when the escalated attempts also
  fail is the task skipped as stuck. `ndx config`, `hench config` and the
  dashboard offer the new keys.
  
  Stuck and forced-advancement exclusions now also apply when selecting from a
  v1 PRD, where they had stopped taking effect.

- [#931](https://github.com/en-dash-consulting/n-dx/pull/931) [`e147a8f`](https://github.com/en-dash-consulting/n-dx/commit/e147a8fd658bb12dd687592b9d983a88697ebdfc) Thanks [@endash-shal](https://github.com/endash-shal)! - API and local agents edit files without rewriting them whole. hench's tool set for the API, local and Gemini loops gains `edit_file` (replace an exact `old_string` with `new_string`; it must match once unless `replace_all` is set, the error names the count, and CRLF files keep their line endings), and the system prompt tells those agents to use it for existing files. `write_file` now refuses to replace an existing file larger than `hench.guard.writeShrinkMinBytes` (default 1024) with content under `hench.guard.writeShrinkRatio` of its size (default 0.5, 0 disables) unless the call passes `rewrite: true`, and points the model at `edit_file`. Livelock, plan-only and completion checks, run summaries and run events count `edit_file` as a file change. Both keys are documented in `ndx config --help`, offered by `hench config` and the dashboard, and checked by the repository trust review.

- [#931](https://github.com/en-dash-consulting/n-dx/pull/931) [`95875df`](https://github.com/en-dash-consulting/n-dx/commit/95875df8e3ddd5fb6a931df791fa6891c1c0fc07) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-model runs no longer die on a slow turn or a malformed reply. Node's fetch waits at most 300 s for response headers, and LM Studio sends none for a non-streamed completion until generation finishes, so a slow model's turn failed with `UND_ERR_HEADERS_TIMEOUT` whatever `llm.local.timeoutMs` said — and the connection retries then resent the same slow request. Local completions (the provider's blocking path, and hench's local tool loop, context summarizer and verifier) are now requested with `stream: true` and `stream_options.include_usage`, so the headers arrive at once, and the server-sent chunks are assembled back into the non-streamed response — content and reasoning concatenated, tool calls merged by index, the finish reason and the usage chunk — so tool-call parsing and token accounting read the same shape as before. `llm.local.timeoutMs` still bounds the whole request (0 = no limit), and a connection dropped mid-stream is retried like a refused one. No new dependency. A 400/500 from the local server saying the model produced malformed output (LM Studio: "The model produced output that does not match the expected … format", and similar) — or the same error arriving inside the stream as an error event — is now resent up to the new `llm.local.maxFormatRetries` times (default 3; 0 disables), one log line per resend; ordinary 400s such as a context-length error, streamed or not, are not resent. When the resends run out the error says what happened and names the setting. `parseLmStudioError` reads LM Studio's string-valued `error`. `ndx config` validates and documents `llm.local.maxFormatRetries`, and the dashboard's Local server settings gain a Retries row for it and the three connection-retry settings.
- Updated dependencies [[`19816b7`](https://github.com/en-dash-consulting/n-dx/commit/19816b719a347f36cb8c96831089836cc62584f7), [`e147a8f`](https://github.com/en-dash-consulting/n-dx/commit/e147a8fd658bb12dd687592b9d983a88697ebdfc), [`c5a6067`](https://github.com/en-dash-consulting/n-dx/commit/c5a6067cfe5db0239e428ecb218a0dc8f92c3a98), [`95875df`](https://github.com/en-dash-consulting/n-dx/commit/95875df8e3ddd5fb6a931df791fa6891c1c0fc07), [`2f058c3`](https://github.com/en-dash-consulting/n-dx/commit/2f058c31d7d95ff2703709872cb7ec2d83757685)]:
  - @n-dx/sourcevision@0.10.2
  - @n-dx/llm-client@0.10.2
  - @n-dx/rex@0.10.2

## 0.10.1

### Patch Changes

- [#881](https://github.com/en-dash-consulting/n-dx/pull/881) [`55a126d`](https://github.com/en-dash-consulting/n-dx/commit/55a126d77e6a5c16d359eccba0d35a8024d85bcc) Thanks [@endash-shal](https://github.com/endash-shal)! - Behind the hub, a project's dashboard header now shows the `projectLinks` of each enabled extension, resolved by the hub for that project. A dashboard with no hub shows no links.

- [#881](https://github.com/en-dash-consulting/n-dx/pull/881) [`3668341`](https://github.com/en-dash-consulting/n-dx/commit/3668341ec83e50ded68f9697fb5880833235d8fc) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub's `/x/<name>/` proxy now keeps the per-user token away from extension sidecars: the `X-Ndx-Token` header, the `ndx_token` cookie and a bearer carrying the token are removed from forwarded HTTP and WebSocket requests, and `X-Ndx-Base-Path: /x/<name>/` is added. The bare `/x/<name>` redirects to `/x/<name>/`. A disabled or unapproved extension answers 404 with the reason, as an unknown one does. `x` is reserved as a project id: the hub refuses to register it, and a repository named `x` gets a hashed id.
  
  The proxy strips the hub token from query parameters as well as headers and cookies, preserves redirects already under the mount, and replaces client-supplied sidecar credentials. Each hub launch uses a separate random NDX_SIDECAR_SECRET checked by the sidecar on HTTP, health and WebSocket requests. Running sidecars revalidate approval, stop on revocation even with open sockets, and exit when the hub lifetime pipe closes. The hub accounts for cold-request disconnects, stopped-instance connections, health-port races and crash backoff.

- [#881](https://github.com/en-dash-consulting/n-dx/pull/881) [`fd0913b`](https://github.com/en-dash-consulting/n-dx/commit/fd0913b4cae9d925f39ed90b9479bdf99b974e1e) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub now runs extension sidecars at `/x/<name>/`. The first request starts the sidecar on an ephemeral loopback port and waits up to 20 s for its `health` path; past that it answers 503 naming the log file under `<ndx home>/ext/<name>/logs/`. A sidecar with no request and no open WebSocket for `idleStopMinutes` is stopped, and `ndx hub stop` stops every one. A crashed sidecar restarts on the next request, backing off after three crashes in five minutes. None starts while available memory is at or below the hub's memory floor. The hub learns how to start each one from the new `ndx extensions sidecar <name> --json`, so discovery, approval and the config check stay in n-dx. `spawnManaged` gains a `logFile` option that appends a child's output to a file.

- [#881](https://github.com/en-dash-consulting/n-dx/pull/881) [`834749c`](https://github.com/en-dash-consulting/n-dx/commit/834749c9c2f00c85b544359cb754dbad7f4cf2f7) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the versioned hub extension API. `GET /api/hub/extensions[?project=<id>]` lists installed extensions with their manifest, state, compatibility and sidecar state. Given a project, it also returns that project's dashboard links. `POST /api/hub/extensions/:name/stop` stops a sidecar. These two endpoints, plus `GET` and `POST /api/hub/projects`, are now experimental under the current `apiVersion` 1 contract, and every answer carries `apiVersion`. `ndx extensions list --json` now includes each extension's `manifest`.
  
  Hub cards distinguish incompatible API versions, and project links resolve correctly for worktrees and the single-project root alias. Extension surfaces remain experimental until explicitly promoted.

- [#881](https://github.com/en-dash-consulting/n-dx/pull/881) [`1d546ce`](https://github.com/en-dash-consulting/n-dx/commit/1d546ce84dd7e084bcc46733f58ad3cfc9474679) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub home now has an Extensions row. Each enabled extension that declares a `hub` entry gets a card linking to `/x/<name>/`. Incompatible and unapproved extensions appear greyed out, with the reason they are held back.

- [`1c4c217`](https://github.com/en-dash-consulting/n-dx/commit/1c4c217dc1204b32fe3732fe256b221a49f0af88) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop active agent runs before manual browser fixtures stop their dashboard.
  Test-only teardown now polls workspace runs and starting executions, confirms
  termination, and falls back to a bounded process-tree kill on API failure.

- [#892](https://github.com/en-dash-consulting/n-dx/pull/892) [`8ad160a`](https://github.com/en-dash-consulting/n-dx/commit/8ad160a1c836062a06ad70eeb3fbf726f9081942) Thanks [@ryrykeith](https://github.com/ryrykeith)! - An applied change that was never placed can be placed with `touches` from the CLI, MCP and dashboard; `amends` is refused because its amendments already reached the map. The guides describe both.

- [#892](https://github.com/en-dash-consulting/n-dx/pull/892) [`5b22c31`](https://github.com/en-dash-consulting/n-dx/commit/5b22c3129a3bb1d5e17efb16e0ba0a44301567ce) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard guide and configuration guide describe the `rex.placementDraft` toggle, the tokens each draft spends, and that a draft only fills the form and never writes.

- [#816](https://github.com/en-dash-consulting/n-dx/pull/816) [`c101993`](https://github.com/en-dash-consulting/n-dx/commit/c101993d87650ef58470c03e85584a0ecc3a4481) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Every child process gets the sanitized environment ([#686](https://github.com/en-dash-consulting/n-dx/issues/686), [#635](https://github.com/en-dash-consulting/n-dx/issues/635)).
  
  - A run can no longer leave n-dx's own config files changed, whichever vendor, provider or tool wrote them. `ndx work` snapshots `.n-dx.json`, `.n-dx.local.json`, `.ndx/config.json`, `.ndx/config.local.json`, `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json` and `.codex/config.toml` before the agent starts. It puts back any that changed after every vendor CLI exits, after every API-loop tool call, and before the test gate. This covers a Codex agent (`codex exec` has no per-path deny), an allowed command such as `node -e` or `npm` under either vendor, and a write under another spelling such as `.N-DX.local.json`. The run fails, and its record (`protectedConfigWrites`) and output name each path and what happened to it, never the content. Don't run `ndx config` or save dashboard settings while `ndx work` is running: an edit made during the run is put back too. The finding says the file changed during the run, without claiming the agent did it, and tells you to save your own change again after the run. A `.claude/`, `.codex/` or `.ndx/` that the agent swapped for a link out of the project is replaced by a directory before anything is put back, so the restore never writes or deletes outside the project, and the run reports the swap as `replaced`. A `.ndx/` created during a run on a legacy-layout project is removed, so the next command reads the same layout and config. A protected directory that cannot be read, such as a link loop, refuses the run at start with a message naming it.
  
  - Commands the repository owns no longer see your credentials. The test gate, post-task tests, `pnpm audit` / `pnpm outdated`, requirement validation commands, the cleanup typecheck, completion validation, rex's `verify_criteria` test command, the pair reviewer's fallback test run and `ndx ci`'s `pnpm docs:build` now run with the same credential filter as the agent's shell (`guard.env`), instead of inheriting the whole parent environment. A `guard.env.allow` entry the repository ships (`.hench/config.json` or the `hench` section of `.n-dx.json`) reaches these commands only while you trust the repository (`ndx trust accept .`). Entries in your git-ignored `.n-dx.local.json` always apply.
  - The cross-vendor pair reviewer's CLI follows the same rule: in an untrusted checkout it keeps the `hench.guard.env.allow` entries in your `.n-dx.local.json` and drops only the repository's, and its warning names only the dropped entries.
  - The same rule now covers the agent's own shell. An untrusted checkout's `guard.env.allow` no longer reaches `run_command`, git or the vendor CLI during `ndx work`; the trust warning says to move a variable your own tests need to `hench.guard.env.allow` in `.n-dx.local.json`, or to run `ndx trust accept .`.
  - Vendor CLI environments keep each vendor mode's credentials from one table. Codex keeps the variable named by the `env_key` of the model provider your own Codex config selects (`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`), so Codex on Azure OpenAI starts with its key; a repository's `.codex/config.toml` and its n-dx config are never read for it. The Gemini CLI on Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI` on) keeps `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. A mode's names are kept only while that mode is active, and `ndx work` reports by name when an active mode has none of its credentials (for the executor and the pair reviewer alike), without promising a fallback the vendor may not have. Two configurations are not detected yet and still read as mode-off, so their credentials are stripped: the Gemini CLI on Vertex AI selected through `selectedAuthType` in its `settings.json` rather than `GOOGLE_GENAI_USE_VERTEXAI`, and Codex profiles kept in the `--profile` file layout rather than `config.toml`. Until they are covered, list the variables they need in `hench.guard.env.allow` in your `.n-dx.local.json`.
  - A repository cannot choose which variable is sent as an API key, or where it is sent. `api_endpoint` (Claude, Codex, Google, and the legacy `claude` block) and `llm.google.apiKeyEnv` in the shared `.n-dx.json` apply only once you trust the repository; until then they are ignored with a warning, and the trust review lists them. The same fields in your `.n-dx.local.json` always apply, and `ndx config` now writes them there. A repository you trusted before that sets one of them reads as changed and asks again. `llm.google.apiKeyEnv` is now read by every loader, not only the auth preflight. `ndx config --test-connection` follows the same rule, so it no longer sends your Claude API key to an untrusted repository's endpoint. So does the Google auth check in `ndx auth`, `ndx init` and `ndx config llm.vendor google`: an untrusted repository's `apiKeyEnv` no longer picks which variable it sends.
  - A repository cannot choose the vendor CLI binary n-dx runs. `llm.claude.cli_path`, `llm.codex.cli_path` and the legacy `claude.cli_path` in the shared `.n-dx.json` apply only once you trust the repository, for `ndx auth`, `ndx init`, `ndx config llm.vendor`, `ndx work` and the cross-vendor reviewer; until then they are ignored with a warning naming the field, and the trust review lists them. `.n-dx.local.json`, where `ndx config` writes `cli_path`, always applies. A repository you trusted before that sets one reads as changed.
  - Nor can it through hench's `claudePath` or the dashboard's CLI version probe. A `claudePath` other than the bare `claude` in `.hench/config.json` or the `hench` section of `.n-dx.json` is listed by the trust review, including when an override of the wrong type in `.n-dx.json` or a tracked `.n-dx.local.json` sits over it, and `ndx work` spawns it only once you trust the repository; `hench.claudePath` in `.n-dx.local.json` always applies, and `ndx init` (for a discovered install path), `ndx config hench.claudePath`, `hench config claudePath` and the dashboard's "Claude CLI Path" now write it there instead of `.hench/config.json`. A checkout an older `ndx init` wrote such a path into reads as untrusted after upgrade; re-running `ndx init` moves it to `.n-dx.local.json` and the checkout reads as baseline again, however init finds Claude (`CLAUDE_CLI_PATH`, a local `cli.claudePath`, `PATH`) and with `--no-claude`. A `hench.claudePath` already in `.n-dx.local.json` is kept. A `claudePath` that is not a well-known install location was set by hand and stays where it is. The dashboard's model catalog probes the binary runs use (`CLAUDE_CLI_PATH`, then the trust-gated `cli_path`) instead of reading `cli.claudePath` and `llm.codex.cli_path` raw from the project config.
  - Nor can it choose the variable hench's API loop sends as the Anthropic key. An `apiKeyEnv` other than `ANTHROPIC_API_KEY` in `.hench/config.json` or the `hench` section of `.n-dx.json` is listed by the trust review and applies only once you trust the repository; until then `ndx work` sends `ANTHROPIC_API_KEY`. `hench.apiKeyEnv` in `.n-dx.local.json` always applies, and `ndx config hench.apiKeyEnv`, `hench config apiKeyEnv` and the dashboard's "API Key Env Var" now write it there, so setting your own no longer marks the checkout untrusted. A repository you trusted before that sets one reads as changed.
  - Nor through `cli.claudePath`. `ndx init` probes and registers MCP servers with the Claude binary before the trust review, so it reads `cli.claudePath` only from `.n-dx.local.json`, where `ndx config cli.claudePath` now writes it. One in the shared `.n-dx.json` is never run and is listed by the trust review; a repository you trusted before that sets one reads as changed. Move a hand-set shared value to `.n-dx.local.json`; `ndx init` names the field and the move while the shared one is skipped.
  - Vendor CLI checks outside `ndx work` get the same environment as `ndx work`'s vendor CLI, no longer your whole shell. That covers the auth check in `ndx auth`, `ndx init` and `ndx config llm.vendor`, the `cli_path` check in `ndx config --test-connection` and `ndx config llm.codex.cli_path`, and the dashboard's CLI version probe. A credential outside the vendor's mode, such as `GITHUB_TOKEN` or the other vendor's key, no longer reaches the binary. The dashboard's probe also applies your `hench.guard.env.deny`, and when the repository's `hench.guard.env` is malformed, the CLI checks ignore only the malformed field and keep every valid deny list, yours included.
  - Nor through `graview.bin`. `ndx graview check|describe|serve|mcp` spawns a `graview.bin` from the shared `.n-dx.json` (or a committed `.n-dx.local.json`) only once you trust the repository; until then it is ignored with a warning and the next source (`NDX_GRAVIEW_BIN`, `PATH`, the product face, npx) is used. The trust review lists it with the vendor CLI paths. One in your untracked `.n-dx.local.json`, and `NDX_GRAVIEW_BIN`, always apply. A repository you trusted before that sets one reads as changed.
  - Nor through its own `node_modules`. When nothing else provides graview, `ndx graview` falls back to `npx -y graview@<pinned>`. That now runs in a directory n-dx owns under the ndx home rather than the project root, so a `graview` the repository installs in `node_modules` is never run, and the repository's `.npmrc` is never read.
  - Nor through `graview.app`. `ndx graview serve` runs the product face a shared `.n-dx.json` (or a committed `.n-dx.local.json`) names only once you trust the repository; until then it is ignored with a warning and the installed `@n-dx/graview-face` is used. The trust review lists it with the vendor CLI paths. One in your untracked `.n-dx.local.json` always applies. A repository you trusted before that sets one reads as changed.
  - `ndx graview` no longer hands your shell's credentials to graview. A graview from `PATH` or the product face, the `npx -y graview@<pinned>` fallback (a binary fetched from the registry) and the product face's server get the same filtered environment as repository commands, instead of the whole parent environment. `PATH`, `HOME` and npm's own config still reach them; npm auth tokens do not.
  - A `guard.env.deny` in `.hench/config.json` now reaches repository commands when the `hench` section of `.n-dx.json` also carries a `guard`. The trust review merged the two `guard` objects shallowly, so a project-config `guard` without `env` dropped the deny entry; it now deep-merges them as hench and `ndx config` do. A trusted repository whose two files both carry a `guard` may read as changed once and ask again.
  - A `.n-dx.local.json` the repository commits is no longer read as yours. Every gate that applied the local file regardless of trust (the agent's shell and repository commands' `guard.env.allow`, the pair reviewer's CLI environment, `cli_path`, `api_endpoint`, `apiKeyEnv`, `hench.claudePath`) now asks git whether the file is tracked. A tracked one is repository config: the trust review lists it (`local-config-tracked`) with what it sets, and none of it applies until you run `ndx trust accept .`; `ndx init` never probes a `cli.claudePath` from it. An untracked file keeps applying everywhere, and in a checkout that is not a git repository nothing is tracked, so the file applies as before. Inside a git checkout where git cannot answer (`detected dubious ownership`, git missing, a corrupt index), the file counts as tracked and waits for `ndx trust accept .`. A file committed under a case variant (`.N-DX.local.json` on macOS or Windows), or reached through a symlink the repository commits (a symlinked `.ndx`, or a local file linking to a committed one), counts as tracked too, and `ndx init` asks the same check through `hench trust status`. So does a local config inside a submodule (a `.ndx` submodule's `config.local.json`, delivered by `git clone --recursive`) or any other nested git work tree, which git in the superproject cannot see; its finding names that directory and gives no `git rm --cached` advice. The finding and its `git rm --cached` advice name the paths git tracks (the case variant as committed, or the symlink and its target), so the advice matches.

- [#892](https://github.com/en-dash-consulting/n-dx/pull/892) [`65c8b1c`](https://github.com/en-dash-consulting/n-dx/commit/65c8b1c21dbfd31d2314185669521ed4df78a100) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Changes view lists the newest release first with open work leading, folds applied changes behind a count, clamps long descriptions, and offers Open, Applied and per-release filters. The web package guide describes the order and filters.

- [#892](https://github.com/en-dash-consulting/n-dx/pull/892) [`b513f57`](https://github.com/en-dash-consulting/n-dx/commit/b513f579b72d013fc1f696686172a00446956f2c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The capture Preview lets you pick a placement and Add & place, and the Inbox section opens a full Inbox page with Place & next and keyboard shortcuts. The web package guide describes both.

- [#892](https://github.com/en-dash-consulting/n-dx/pull/892) [`ef50c66`](https://github.com/en-dash-consulting/n-dx/commit/ef50c66f576a4978e7739d15a7d95f531d61313c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard server reads, places and proposes Inbox changes on a v2 project: `GET /api/rex/changes/:id/placement`, `POST …/place` and `POST …/propose`. `/api/status` reports `rex.inbox`, change rows carry `awaitsPlacement`, and `POST /api/rex/items` accepts `touches`.

- [#892](https://github.com/en-dash-consulting/n-dx/pull/892) [`7f6674f`](https://github.com/en-dash-consulting/n-dx/commit/7f6674ffabc0a6163e0cca24de621f771488af3b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard has an Inbox section on Plan, an Inbox count on the Plan tab and bottom bar, an Inbox badge and filter in the Tasks tree, and placement in an Inbox change's detail panel. The web package guide describes finding and placing an Inbox change.

- [#892](https://github.com/en-dash-consulting/n-dx/pull/892) [`dffaf8b`](https://github.com/en-dash-consulting/n-dx/commit/dffaf8bfaaf5031703171dbd4a8c559127313a76) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Fix the Plan page scrolling sideways at 1,024px: the top bar drops its product hints and search label below 1,100px, and a long change title in the capture Preview wraps instead of being cut off.

- [#871](https://github.com/en-dash-consulting/n-dx/pull/871) [`1df7e27`](https://github.com/en-dash-consulting/n-dx/commit/1df7e2744f2424cef8293290bcc04a901b138d41) Thanks [@endash-shal](https://github.com/endash-shal)! - Work page: Change Progress is a dropdown, closed by default, of blocks two to a row, with filters by name, status (completed hidden by default), tag and owner. It sits full width under the panels, which now sit three to a row at equal height (Priority Distribution and Status Breakdown share one), and it is no longer behind the scroll reveal that could leave it transparent. The dashboard's per-change stats carry each change's tags and its assignees.
- Updated dependencies [[`3668341`](https://github.com/en-dash-consulting/n-dx/commit/3668341ec83e50ded68f9697fb5880833235d8fc), [`fd0913b`](https://github.com/en-dash-consulting/n-dx/commit/fd0913b4cae9d925f39ed90b9479bdf99b974e1e), [`de8bc93`](https://github.com/en-dash-consulting/n-dx/commit/de8bc939849ed25a4376dca29ec18646cc906954), [`e8d2ad2`](https://github.com/en-dash-consulting/n-dx/commit/e8d2ad2ce54a19505dccf38a8b8f33d1a40cc4e4), [`8ad160a`](https://github.com/en-dash-consulting/n-dx/commit/8ad160a1c836062a06ad70eeb3fbf726f9081942), [`5b22c31`](https://github.com/en-dash-consulting/n-dx/commit/5b22c3129a3bb1d5e17efb16e0ba0a44301567ce), [`c101993`](https://github.com/en-dash-consulting/n-dx/commit/c101993d87650ef58470c03e85584a0ecc3a4481), [`916ed4e`](https://github.com/en-dash-consulting/n-dx/commit/916ed4e7925e23a5f0bd2c059340f733f0a975ab), [`1df7e27`](https://github.com/en-dash-consulting/n-dx/commit/1df7e2744f2424cef8293290bcc04a901b138d41)]:
  - @n-dx/llm-client@0.10.1
  - @n-dx/rex@0.10.1
  - @n-dx/sourcevision@0.10.1

## 0.10.0

### Patch Changes

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`aa7886f`](https://github.com/en-dash-consulting/n-dx/commit/aa7886f0b4069fb6a06a0043d94f1b79b3afa709) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx config <pkg>.<key> <value>` refuses a key with a `__proto__`, `constructor` or `prototype` segment. `ndx config llm.__proto__.polluted x` followed `configs.llm["__proto__"]` onto `Object.prototype` and assigned there, in the CLI's own process; the write was never persisted, but the command now exits non-zero naming the segment and leaves every config file untouched. hench's `setConfigValue` applies the same guard behind its `CONFIG_FIELDS` allowlist.
  
  The `ndx work` command that `ndx work --resolve` prints is now correct on Windows for a path that ends in a backslash or contains a quote: backslashes before a `"` or the closing quote are doubled, as the argv rules every Node program decodes with require, so `C:\My Repo\` prints as `"C:\My Repo\\"` rather than `"C:\My Repo\"`.
  
  Four regular expressions that were quadratic on hostile input scan linearly: the `icacls` ACE parser behind owner-only config files (the same result on every icacls line; it now rejects a line with a `(` inside a flag group or a `:(` inside an identity, which icacls never prints), the trailing-separator trim in the MCP shim's workspace key, and the project-id slug in `ndx start` and its twin in the hub's new-project page (the same result on every input). `ndx ci`'s data-layer check now escapes every regex metacharacter in a layout directory name rather than only the dot.

- [#839](https://github.com/en-dash-consulting/n-dx/pull/839) [`27b5833`](https://github.com/en-dash-consulting/n-dx/commit/27b583370e486993ec1760d169db8f4461e0f9ef) Thanks [@endash-shal](https://github.com/endash-shal)! - Closing a feature's last task from the dashboard now completes the feature, and its epic when that was the epic's last open work, as `rex update` and the MCP `update_task_status` tool already did. The dashboard's status and bulk-status routes used to save only the task. Its feature stayed pending with every child done, so `ndx loop` selected the empty feature as the next task and handed the agent a run with nothing to do. The parent cascade is now one rex function, `cascadeParentCompletion`, shared by all three writers.

- [#838](https://github.com/en-dash-consulting/n-dx/pull/838) [`0f98b3e`](https://github.com/en-dash-consulting/n-dx/commit/0f98b3e0aa53d34e30cdd497538aa2778b4d3677) Thanks [@endash-shal](https://github.com/endash-shal)! - The Analyze dashboard and the Overview page gain a Delivery & infrastructure panel. It shows the SDLC readiness score from `readiness.json`, with each practice's score (tests, CI, CD, rollback, migrations, feature flags, quality gates, observability, agent safety), and the resources in `infrastructure.json` counted by kind. Opened, it lists each practice's evidence and gaps and every resource with the file that declares it. When an analysis has not written either file, it says to run `ndx analyze`. `ndx export` now copies both files, so a static dashboard shows the panel too.

- [#838](https://github.com/en-dash-consulting/n-dx/pull/838) [`3234e51`](https://github.com/en-dash-consulting/n-dx/commit/3234e51ae4bb72169538bfeb55fcf80e54e9af74) Thanks [@endash-shal](https://github.com/endash-shal)! - Hub project cards show the project's SDLC readiness score and how many infrastructure resources its analysis found, from the `readiness` and `infrastructure` fields each project server already reports in `GET /api/status`. A card leaves both off when the project server is an older build that does not report them, and leaves the infrastructure count off when it is zero.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`166e33f`](https://github.com/en-dash-consulting/n-dx/commit/166e33fc06eee3b00482fa5283eb0e3731af6efe) Thanks [@endash-shal](https://github.com/endash-shal)! - One host and port shape rule for the local LLM endpoint. `@n-dx/llm-client` exports `isPlausibleLlmHost`, `isValidPort` and `describeLocalEndpointProblem`, and the local inference provider refuses a saved `llm.local.host` or `llm.local.port` that fails them before building its URL — a hand-edited `.n-dx.json` used to reach `fetch` unchecked. The dashboard imports the rule instead of carrying a copy, and reports a saved port written as a string as invalid rather than silently probing 1234. `ndx config llm.local.host` (and `llm.local.verifier.host`) refuses a host carrying a path, credentials, a second port or whitespace, and accepts `localhost`, `127.1`, `[::1]` and a LAN name — `127.1` was previously coerced to a number and refused. A parity test holds core's inline copy equal to llm-client's.

- [#838](https://github.com/en-dash-consulting/n-dx/pull/838) [`9e18581`](https://github.com/en-dash-consulting/n-dx/commit/9e185812cb4ec52603e67d6c295568ea5334b4ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Next-task selection no longer goes quadratic in PRD size, which had made the dashboard unresponsive on a large PRD. rex's ranking scored every item through `collectRequirements`, which re-finds the item with a full tree walk, so one `findNextTask` cost about half a second on a 2,800-item tree; it now traces requirements from the entry it already holds. The dashboard's Live monitor, which ranks the next five tasks every two seconds, also keeps each ranking per parsed PRD and excluded set instead of recomputing it every tick, so a tick that changes nothing costs nothing.

- [#839](https://github.com/en-dash-consulting/n-dx/pull/839) [`b0b8e32`](https://github.com/en-dash-consulting/n-dx/commit/b0b8e32d5595265bd257a6f7f2d11587d189fef3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add two browser test layers to the dashboard: a manual Playwright suite (`pnpm run test:e2e-manual`) that records video of three real-vendor flows — prompt to completed agent run, analysis plus a form-added task to completion, and a Settings vendor/model switch followed by a three-task iteration run on Claude then Codex — and happy-click specs in the automated `e2e-ui` suite that press every safe control on every dashboard page and assert its intended effect, with a shared click policy naming what a sweep must never press.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`60c910a`](https://github.com/en-dash-consulting/n-dx/commit/60c910a463e935bf6af6715f31a416e2ba1d7050) Thanks [@endash-shal](https://github.com/endash-shal)! - Code-coverage path matching honours a path separator: `lib/util.ts` in a task's description no longer matches a changed `mylib/util.ts`, while `src/lib/util.ts` still matches `lib/util.ts` in both directions. The index.md Commits table escapes `|` and `\` in the author cell as it already did in the message cell, and the dashboard's parser splits rows on unescaped pipes only and undoes both escapes, so a message or author holding either round-trips losslessly. The frontmatter fallback decoder (a double-quoted scalar that is not valid JSON) now also decodes `\b`, `\f`, `\/` and a four-hex-digit `\uXXXX` like JSON, keeping a shorter `\u` literal.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`7c12c18`](https://github.com/en-dash-consulting/n-dx/commit/7c12c182e92139a5201affc48343ce00eb442f55) Thanks [@endash-shal](https://github.com/endash-shal)! - A hand- or agent-written `index.md` whose double-quoted frontmatter value holds an escape JSON lacks (such as `\x`) is now decoded in one pass. The fallback decoder read its own output: `C:\\new` became `C:\new` and then `C:` followed by a line feed, and every save after that compounded the change. The escapes JSON shares (`\n`, `\t`, `\r`, `\"`, `\\`) are decoded; any other `\c` is kept as written, as before.
  
  Four scans of repository content no longer take quadratic time: the block-scalar chomping in both the folder-tree parser and the legacy `prd.md` parser (a run of thousands of blank lines inside a description), the trailing-punctuation trim on a requirement sentence extracted from an analysed README, and the number check the legacy serializer runs on every string scalar. Results are unchanged. A commit message in a generated `index.md` commits table now escapes `\` as well as `|` and folds line breaks, so a message cannot break out of its cell. The web package drops an unused import.

- [#859](https://github.com/en-dash-consulting/n-dx/pull/859) [`a4476cb`](https://github.com/en-dash-consulting/n-dx/commit/a4476cbe72bcc08c2a739d3eb30a68434e6369b9) Thanks [@endash-shal](https://github.com/endash-shal)! - The run-project control moves from the bottom bar to the top nav, beside
  search, and is always shown. It is disabled, with the reason in its tooltip,
  until the project has a detected run or build command, and in a static export.

- [#862](https://github.com/en-dash-consulting/n-dx/pull/862) [`c92eb9c`](https://github.com/en-dash-consulting/n-dx/commit/c92eb9ca7114170beda601782aecae71992d40da) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On a v2 project the dashboard's add panel no longer calls itself Smart Add or says it generates proposals. It is "Add to Inbox": the text becomes one change in the Inbox, its first line the title and the full text its description, and the preview shows both and names the next step (place the change, then add its tasks). `rex add --format=json` on v2 now includes each change's `description`. v1 projects keep Smart Add as it was.

- [#749](https://github.com/en-dash-consulting/n-dx/pull/749) [`582752e`](https://github.com/en-dash-consulting/n-dx/commit/582752ec5bda44987ab8d9614ec19620e84f3140) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx install-sample` on a v2 project adds the sample as a change with two tasks through `rex add`, instead of writing a `prd_tree/` beside `product/`; `ndx destroy-sample` removes it. A v1 project is unchanged.
  
  Changes what a CLI command writes under the soft freeze: on a v2 project `ndx install-sample` and `ndx destroy-sample` write the change layer (`{rex}/changes/`), not `prd_tree/`. No flag changes shape.
  
  `rex remove <id>` now works on a v2 PRD, removing a change, task or subtask inside the PRD lock. `ndx destroy-sample` on a v2 project uses it instead of deleting change folders itself, and fails naming the lock holder when another writer holds the lock.
  
  Widens a CLI command under the soft freeze: `rex remove` accepts v2 change, task and subtask ids (it refused v2 trees before). No flag or MCP tool changes shape.
  
  The first `/api/rex/prd` read after `ndx start` no longer answers 404 on a folder tree: the boot PRD cache is written before the server listens, so a request cannot beat it.
  
  Changes a v2 rule under the soft freeze: `change-placed-at-close` is a warning, not an error, for a change the migration held for placement that completed in v1, at or before the plan's cut or between the plan and apply (the cut change lists the latter). A held change that completes in v2 after apply is still an error. A `blockedBy` ref to a product node whose pending work is held in the Inbox now names the held changes instead of being dropped as met.
  
  The apply-side fixes on this layer (blockedBy rewrites onto open changes, the guarded `prd_tree/` leftover removal, the dry run listing each rewrite) are described in the `ndx migrate --apply` changeset, migrate-apply.md.

- [#862](https://github.com/en-dash-consulting/n-dx/pull/862) [`6957df6`](https://github.com/en-dash-consulting/n-dx/commit/6957df6c10ddb5a49cc74d82a452470fc4b492f8) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On a v2 project the dashboard can add a task under a change. A change's detail panel offers "+ Add Task", with a title, description, criteria and priority, and the task is written under the change through rex's own add rule, as `rex add --type=task --parent=<id>` and MCP `add_item` write it. A completed change refuses a new task with rex's reason. `POST /api/rex/items` with a parent used to be refused on v2, which left a project started from the dashboard with changes that had no tasks.

- [#749](https://github.com/en-dash-consulting/n-dx/pull/749) [`7fa688f`](https://github.com/en-dash-consulting/n-dx/commit/7fa688f0127249893d469e67716780ab8c1bb15d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex migrate-plan`, `rex migrate-apply --dry-run` and `rex migrate-apply` refuse a v1 tree with an item file the parser cannot read, such as unclosed front matter left by a hand edit or a merge conflict. The refusal names each file. Before this, the store's load dropped the parser's warning, so the plan and the dry run left the item out without saying so, and apply then removed `prd_tree/` along with that item's file. The v1 parser now marks a warning `skipped` when it drops an item, as the v2 reader already did.
  
  `rex migrate-apply` and its `--dry-run` print the v2 rule findings on the migrated tree, counted by rule (errors and warnings), as `rex health` then reports them. They are reported, not refused. A test now pins apply's refusal when the tree reads back without a v1 id.
  
  `rex migrate-apply` keeps a dissolved release epic's description and acceptance criteria under its line in the cut change's body, and moves its own `blockedBy` onto its open children, so a release's work still waits for the release it depended on.
  
  `migrate --apply`: when removing `prd_tree/` or `tree-meta.json` fails after the v2 tree is switched in (a handle held on Windows), apply now says the v2 tree is in place, names the leftovers and the underlying error, and gives the manual step to clear them, instead of throwing the raw error.
  
  `migrate --apply`: every leftover `prd_tree/` message now names the leftover and the same manual step (check the v2 tree holds everything in it, then delete it by hand). A failed removal after the switch no longer promises a re-run finishes the job, and a failed removal on an already-v2 apply says the v2 tree is in place instead of throwing the raw error.
  
  A migration plan's `metAt` now follows a capability's spec when a later pass redrafts it, instead of keeping the rules-stage draft's hash.
  
  `ndx migrate` (the bare chain) now shows the preflight banner, and its `--dry-run` runs no model unless `--with-models` is given
  
  `rex migrate-plan`, `rex migrate-apply` and `ndx migrate-layout` refuse inside an agent run (`NDX_AGENT_RUN` set), as `ndx migrate` already does.
  
  `rex migrate-to-folder-tree` keeps the PRD title
  
  The command wrote the tree but not `.rex/tree-meta.json`, so a migrated project
  read back as "PRD". It now writes the sidecar with the source document's title.
  
  `rex migrate-slugs` on a v2 tree now says slugs are frozen there and applies to v1 trees only, instead of pointing at the v1 `rex migrate-to-folder-tree` command.
  
  Placing an Inbox change (`rex change place`) carries the non-tree files in its folder into `changes/<slug>/` with it, and removes the empty Inbox folder; a name clash refuses before anything is written.
  
  The v2 writer keeps a moved folder node's extra top-level `state.yaml` keys (keys a newer rex wrote) in its new folder. A node that moves and loses its last child in the same write is refused, naming its old folder and the keys, instead of dropping them.
  
  Writes on a v2 tree now stamp `lastModified` and `lastModifiedBy` on every
  node they change, create or move, as v1 writes do. Before, `update_task_status`,
  `edit_item`, `add_item` and `move_item` left a node's old stamp in place and
  gave a new change none, so remote sync and the dashboard read v2 writes as
  stale. A write that changes nothing stamps nothing. The stamp lands in the
  node's `state.yaml` row, so a write now also rewrites that file.
  
  The rex MCP `get_capabilities` tool now reports `"schemaVersion": "rex/v2"` on a
  v2 tree. It answered `"rex/v1"` beside `"adapter": "v2-change-layer"`, so a
  client that reads `schemaVersion` took the tree for v1. A v1 tree still reports
  `rex/v1`. The change layer store declares its version through the new optional
  `schemaVersion` on `StoreCapabilities`.
  
  `get_product` now answers with a summary by default: each area with its counts
  of capabilities and constraints by status, defective nodes and open changes.
  Pass `area` (an id or display id) for that area's capabilities and constraints,
  or `full: true` for the whole map, the previous default. On a large v2 tree the
  whole map exceeded what an MCP client accepts and was refused. The
  `/ndx-capture`, `/ndx-plan`, `/ndx-reshape` and `/ndx-adversarial-review`
  skills read the summary, then the areas they need.
  
  The preflight banner and the dashboard's command effects name `changes/` and `product/` for the PRD on a v2 project instead of `prd_tree/`, which a v2 project does not have.
  
  The dashboard server turns off rex's v1-layout deprecation notice for the commands it spawns, so a failing rex spawn on a v1 project shows its real error and not the notice first.
  
  `rex next` labels v2 work by type (`[change]`, `[task]`, `[subtask]`), never `[epic]`. On a v2 tree, `level` in MCP and JSON payloads is the v1 projection of `type` and nesting: it stays for compatibility in this release and is deprecated. `type` is authoritative; the release that refuses v1 PRDs removes `level` from every v2 payload.
  
  Changes under the soft freeze:
  - `ndx migrate --dry-run` (the bare chain) runs no model unless the new `--with-models` flag is given.
  - `rex migrate-plan`, `rex migrate-apply` and `ndx migrate-layout` refuse inside an agent run.
  - `rex migrate-plan`, `migrate-apply` and its dry run refuse a v1 tree with an item file the parser skipped.
  - MCP `get_capabilities` reports `schemaVersion: rex/v2` on a v2 tree.
  - MCP `get_product` answers with a per-area summary by default; `area` and `full: true` reach the detail, and `full: true` is the previous default.
  - v2 writes stamp `lastModified` / `lastModifiedBy`.
  - `level` is deprecated on v2 payloads (kept in this release); `rex next` text labels v2 work by type.
  - The preflight banner and command effects name `changes/` and `product/` on a v2 project.

- [#862](https://github.com/en-dash-consulting/n-dx/pull/862) [`dd7c1ed`](https://github.com/en-dash-consulting/n-dx/commit/dd7c1ed4fd2f34039b3b11b3416a34fc57d5a82f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On a v2 project, progress counts a change with no tasks as one unit of work. A root change used to be counted like a v1 epic, a pure grouping, so an open change with no tasks counted for nothing and the Work page, the home Plan card and the status bar could read 100% while it was open. The Work page's progress panel now says changes rather than epics on v2, and a change with no tasks shows its status instead of 0/0. v1 numbers and labels are unchanged.

- [#838](https://github.com/en-dash-consulting/n-dx/pull/838) [`fb704d4`](https://github.com/en-dash-consulting/n-dx/commit/fb704d4c972b75ab3d5f64e45175d8def66c9a32) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard no longer shows "Drop .sourcevision files" when its server answers but will not serve it. The viewer's first `/data` request used to be one-shot, and any non-200 — including the hub's 503 while `ndx start` was still bringing the project server up — put the tab into file-drop mode, asking for files the server already had. The viewer now retries `/data` for about ten seconds, keeps re-probing an unavailable server every five seconds and loads as soon as it answers, and in the meantime says what happened: a project server still starting, a 401 on a missing or rotated token (open the URL `ndx start` printed), a 421 on the wrong host, or a 409 on a hub root shared by several projects. File drop is offered only when nothing serves `/data` at all (a `file://` open or a 404).

- [#837](https://github.com/en-dash-consulting/n-dx/pull/837) [`08de1ee`](https://github.com/en-dash-consulting/n-dx/commit/08de1eeb483ed2429189d3670ea47898b705c301) Thanks [@endash-shal](https://github.com/endash-shal)! - The Prepare task modal no longer has the Work page painted over it. Opened from
  the "Up next" card, it sat inside that card's `z-index: 1` stacking context, so
  the panels beside the card drew on top. It now renders under `<body>`, as do
  the Guide and FAQ overlays, which were capped the same way by the top nav and
  the bottom bar.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`b6a6231`](https://github.com/en-dash-consulting/n-dx/commit/b6a62314c60727282da817354d42ddd1bc0a308b) Thanks [@endash-shal](https://github.com/endash-shal)! - Every dashboard route now answers a failure with the error's message alone. Routes that stringified the caught value (`String(err)`, which reads "Error: <message>") or hand-rolled an `instanceof Error` ternary with a stringified fallback go through the one `errorMessage()` helper, as the smart-add accept route already did, and the served status fields (sv-analyze, self-heal, init, refresh, the generic command jobs, epic-by-epic execution, hench task execution and run reconcile) carry the same message. A thrown non-Error is logged on the server and answered with a fixed line instead of its string form. A test under `packages/web/tests/integration/` fails any `errorResponse`/`jsonResponse` argument that stringifies the caught value, and any file under `src/server/` that writes the ternary again.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`a956d1f`](https://github.com/en-dash-consulting/n-dx/commit/a956d1faca55705049d1e1f8c86f658faaeda5e4) Thanks [@endash-shal](https://github.com/endash-shal)! - The LLM catalog reports a saved `llm.local` host or port that fails the shape check as `needs-setup`, with the shape error as the vendor card's line, instead of claiming "Not reachable" for a server the probe never contacted. `routes-workflow.ts` drops its private copies of the guarded config path helpers and the forbidden-segment set in favour of the shared ones in `hench-config-fields.ts`. The error-message policy test now sees `String(e as Error)`, `${err}`, `err.toString()`, other catch-variable names and the ternary wrapped across lines.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`92161a4`](https://github.com/en-dash-consulting/n-dx/commit/92161a4b72c443a60f677c1e30892d10dbac636b) Thanks [@endash-shal](https://github.com/endash-shal)! - `PUT /api/llm/config` and `POST /api/llm/config/preview` refuse a path with a `__proto__`, `constructor` or `prototype` segment. A delete of `llm.tiers.__proto__.toString` (a `null` or `""` value) skipped the tier shape check, walked through `config.llm.tiers["__proto__"]` — Object.prototype — and removed `toString` from the dashboard process; `llm.routes.__proto__` answered 200 for a write that did nothing. A delete is now held to the `llm.tiers.<vendor>.<tier>` shape like a set, and the nested set and delete helpers refuse those segments on their own as well. The features route writes through the same guarded helper the hench and adaptive routes use, and the workflow suggestion allowlist checks own keys only, so a body keyed `toString` no longer reaches `.hench/config.json`.

- [#846](https://github.com/en-dash-consulting/n-dx/pull/846) [`8ead882`](https://github.com/en-dash-consulting/n-dx/commit/8ead882b2bf9d64e9f982f1d6de582f30e3e6494) Thanks [@endash-shal](https://github.com/endash-shal)! - The cookie-setting redirect that follows a `?ndx_token=` navigation now stays
  on the dashboard's own origin. Node hands the request-target to `req.url`
  unparsed, so `GET //evil.com/?ndx_token=T`, the absolute form
  `GET http://evil.com/x?ndx_token=T` and `/\evil.com/` were echoed into
  `Location` verbatim; a request-target that is not a plain `/path` now
  redirects to `/`. Both the hub and the project server share the one fix.
  
  The local LLM endpoints (`POST /api/llm/local-test`, `POST /api/llm/local-profiles`,
  `PUT /api/llm/config` for `llm.local.host`) refuse a host or port that the
  probe URL `http://${host}:${port}/v1/…` could not read back as that host and
  port: a path, a query, credentials, a second port, whitespace, or a port outside
  1–65535 answers 400. `GET /api/llm/local-status` and the catalog's local probe
  report a saved value that fails the same check instead of fetching it. The check
  is on shape only: a LAN GPU box remains a supported configuration.

- [#839](https://github.com/en-dash-consulting/n-dx/pull/839) [`0e03074`](https://github.com/en-dash-consulting/n-dx/commit/0e0307419bbbf9a6a8a0222908f523ebdfac06ea) Thanks [@endash-shal](https://github.com/endash-shal)! - Windows: no more console windows from n-dx's child processes. `exec()` and `spawnCli` in llm-client gain a `windowsHide` option that defaults to true, and every other production spawn in the monorepo passes it; a new root policy test (`windows-hide-policy`) fails any spawn that does not. The vendor-CLI log `claude_commands.log` is now gitignored by `ndx init` and discounted by hench's uncommitted-work gate, so a fresh project's first agent run no longer refuses completion over it. The Overview page's isometric hero shows its Options button again.
- Updated dependencies [[`27b5833`](https://github.com/en-dash-consulting/n-dx/commit/27b583370e486993ec1760d169db8f4461e0f9ef), [`ef16b52`](https://github.com/en-dash-consulting/n-dx/commit/ef16b523939f3f33dca5122b52130339cc303b40), [`96bc0a4`](https://github.com/en-dash-consulting/n-dx/commit/96bc0a4bddc1d5c6446e094d29a1b081801b257a), [`0fc868e`](https://github.com/en-dash-consulting/n-dx/commit/0fc868e8884455bb11755ee0c1f72ba4508cc1dc), [`a5c696f`](https://github.com/en-dash-consulting/n-dx/commit/a5c696f3acc9e63a7f5228bc499e64b5c95bd0eb), [`331e040`](https://github.com/en-dash-consulting/n-dx/commit/331e04027029afc39db9b66722fbc1d155d538f3), [`f0547c4`](https://github.com/en-dash-consulting/n-dx/commit/f0547c402f756734ecf85a26365141d6bc806d03), [`a76c462`](https://github.com/en-dash-consulting/n-dx/commit/a76c4623ca1c9917fd5ebcfdd718ca448b36500e), [`1c9ca5e`](https://github.com/en-dash-consulting/n-dx/commit/1c9ca5e4cfcc161657a9958887463b2f8cd37a2a), [`f47ebc5`](https://github.com/en-dash-consulting/n-dx/commit/f47ebc52247e319e1f61e6a77b13701da2c06a8e), [`9ff58a3`](https://github.com/en-dash-consulting/n-dx/commit/9ff58a316861865c0cfe0237b95cbca755375f74), [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f), [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413), [`24e4dba`](https://github.com/en-dash-consulting/n-dx/commit/24e4dba1b2278c4ed2d6309e7fa6a808c5f0ffb0), [`bcb494a`](https://github.com/en-dash-consulting/n-dx/commit/bcb494a54b15ba96c66083129f9191426bcb2b6b), [`6144a9c`](https://github.com/en-dash-consulting/n-dx/commit/6144a9cd36eb62a872b0578dda68016c01f314e9), [`4443ec0`](https://github.com/en-dash-consulting/n-dx/commit/4443ec08e1432dd0648c5e1c8f972408d3bff5c9), [`166e33f`](https://github.com/en-dash-consulting/n-dx/commit/166e33fc06eee3b00482fa5283eb0e3731af6efe), [`a827aaa`](https://github.com/en-dash-consulting/n-dx/commit/a827aaa8d854d328271ff4411ba0fe6158c3195d), [`be77a84`](https://github.com/en-dash-consulting/n-dx/commit/be77a847e3b0805b8e76c0d0ea89bcc0e099d538), [`2b00932`](https://github.com/en-dash-consulting/n-dx/commit/2b00932c9219ba7eb18f446493e2549170aafe48), [`240579c`](https://github.com/en-dash-consulting/n-dx/commit/240579c9200b144629a6069cf9a752d4eaaa1492), [`9e18581`](https://github.com/en-dash-consulting/n-dx/commit/9e185812cb4ec52603e67d6c295568ea5334b4ec), [`6095466`](https://github.com/en-dash-consulting/n-dx/commit/6095466c148ea9437f3263ebf4923c4484037799), [`b7ae2e1`](https://github.com/en-dash-consulting/n-dx/commit/b7ae2e13d965735747f01d882f6a96d54318bc93), [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73), [`22a8d63`](https://github.com/en-dash-consulting/n-dx/commit/22a8d632eb780c0ba39340970e990d84c934bc39), [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92), [`f901248`](https://github.com/en-dash-consulting/n-dx/commit/f9012480fce7578a73592eeddc371f472026fed6), [`7e3cded`](https://github.com/en-dash-consulting/n-dx/commit/7e3cdedf02eb5ac2ef6daeaa11e02e20ef8c8725), [`4ce8d35`](https://github.com/en-dash-consulting/n-dx/commit/4ce8d35c2939007e44995d3fc0334863965a0b4c), [`60c910a`](https://github.com/en-dash-consulting/n-dx/commit/60c910a463e935bf6af6715f31a416e2ba1d7050), [`7c12c18`](https://github.com/en-dash-consulting/n-dx/commit/7c12c182e92139a5201affc48343ce00eb442f55), [`1ce57b0`](https://github.com/en-dash-consulting/n-dx/commit/1ce57b0a9f991d118247806e8f4b1a07bc6561da), [`5036736`](https://github.com/en-dash-consulting/n-dx/commit/5036736f9c2ac584d09bab8cba121f8b531a3f3f), [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92), [`100afd3`](https://github.com/en-dash-consulting/n-dx/commit/100afd3d1de9bbbecf2212e35c3f45ae50fffe1b), [`6becaf1`](https://github.com/en-dash-consulting/n-dx/commit/6becaf1a9863ea1dd585835b1755270501be5a64), [`796c395`](https://github.com/en-dash-consulting/n-dx/commit/796c395e3607c53378572e4af25bfe853537fa60), [`ee61f46`](https://github.com/en-dash-consulting/n-dx/commit/ee61f46e39a4fa763cf44bb20acbd6a8a831fdae), [`bb5c3a8`](https://github.com/en-dash-consulting/n-dx/commit/bb5c3a8242af4d0672e1abffdb2929704af8317b), [`1e68e16`](https://github.com/en-dash-consulting/n-dx/commit/1e68e164223627e1d987ed2a4488a4df6f47a1db), [`94eaddd`](https://github.com/en-dash-consulting/n-dx/commit/94eaddd9b6bb7652033934bb1296f62ac64446b3), [`7806b8b`](https://github.com/en-dash-consulting/n-dx/commit/7806b8bca81d6b776f016f5ac1e98ae255867450), [`c8e9543`](https://github.com/en-dash-consulting/n-dx/commit/c8e9543d95de373d92e0b5ab109317c870b33fc1), [`763f08f`](https://github.com/en-dash-consulting/n-dx/commit/763f08f1b0b76322a17901d4eb00af2b39653728), [`0625c57`](https://github.com/en-dash-consulting/n-dx/commit/0625c57081759d7195798af283a18dc14cc8bee3), [`334737b`](https://github.com/en-dash-consulting/n-dx/commit/334737bd41f40251a6217bfc409e7558509177e1), [`6d20bd4`](https://github.com/en-dash-consulting/n-dx/commit/6d20bd4e52f04a469ba11da408c9cbdba5bf16b6), [`d29704c`](https://github.com/en-dash-consulting/n-dx/commit/d29704ccf8729095614409dddbc354afde1a4bfa), [`5059d70`](https://github.com/en-dash-consulting/n-dx/commit/5059d70192fcb3a313dda6d829c66e7e39bca88f), [`1c042fb`](https://github.com/en-dash-consulting/n-dx/commit/1c042fb2f764c7153fa035c46361413b1fef94c5), [`af2fe02`](https://github.com/en-dash-consulting/n-dx/commit/af2fe02832e7ac2e9a601a3b6983c137ab17a3ef), [`953c449`](https://github.com/en-dash-consulting/n-dx/commit/953c449983359a3ffc0e94d5c1e4e969c897b9ae), [`7c2324e`](https://github.com/en-dash-consulting/n-dx/commit/7c2324e728bd5fed0b34e0a9a0b005f072d6db4f), [`faf4d18`](https://github.com/en-dash-consulting/n-dx/commit/faf4d183cfdb0d3191c688f99e8ea7d2aaf8fcad), [`51e3582`](https://github.com/en-dash-consulting/n-dx/commit/51e35829bb4bcca200d775418daa6fad09b70ec3), [`df60182`](https://github.com/en-dash-consulting/n-dx/commit/df601824a2589d91c43f469cdffcf777cfb9270e), [`c92eb9c`](https://github.com/en-dash-consulting/n-dx/commit/c92eb9ca7114170beda601782aecae71992d40da), [`582752e`](https://github.com/en-dash-consulting/n-dx/commit/582752ec5bda44987ab8d9614ec19620e84f3140), [`6957df6`](https://github.com/en-dash-consulting/n-dx/commit/6957df6c10ddb5a49cc74d82a452470fc4b492f8), [`7fa688f`](https://github.com/en-dash-consulting/n-dx/commit/7fa688f0127249893d469e67716780ab8c1bb15d), [`dd7c1ed`](https://github.com/en-dash-consulting/n-dx/commit/dd7c1ed4fd2f34039b3b11b3416a34fc57d5a82f), [`2471bd7`](https://github.com/en-dash-consulting/n-dx/commit/2471bd7263746886671f0c29cb8abe94bf28b8c1), [`0e03074`](https://github.com/en-dash-consulting/n-dx/commit/0e0307419bbbf9a6a8a0222908f523ebdfac06ea)]:
  - @n-dx/rex@0.10.0
  - @n-dx/sourcevision@0.10.0
  - @n-dx/llm-client@0.10.0

## 0.9.1

### Patch Changes

- [#747](https://github.com/en-dash-consulting/n-dx/pull/747) [`02eed9a`](https://github.com/en-dash-consulting/n-dx/commit/02eed9a6fa283936ae81862c213be3d4ee323b0a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The capability page's edit form is now reachable from the dashboard.
  
  [#729](https://github.com/en-dash-consulting/n-dx/issues/729) built the form, but nothing mounted it and no route ran rex's
  `handleProductEdit`. `POST /api/rex/product/edit` now applies an edit to a
  capability's statement and its own criteria's text inside rex's v2 transaction,
  and the capability page passes `onEdit` so a save posts to it and refetches.
  The editorial checkbox keeps its meaning: checked records a History line and
  keeps the capability met; unchecked marks it revised and drafts a change in the
  Inbox to build the difference. On a v1 tree the route answers 409 and the
  capability page stays read-only. `@n-dx/rex` now exports `handleProductEdit` and
  `ProductEditError`.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`7714de5`](https://github.com/en-dash-consulting/n-dx/commit/7714de5b3ea4e788597a5ff855ed83e1c88392d9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `GET /api/llm/catalog` reports each vendor's `readiness` (`ready`, `needs-setup`
  or `unreachable`, with a one-line summary) for the provider it would run on.
  API-key presence is reported as a boolean; the key itself is never returned.

- [#715](https://github.com/en-dash-consulting/n-dx/pull/715) [`1abeb88`](https://github.com/en-dash-consulting/n-dx/commit/1abeb885cd14a6a61222aa5073e2700fa78ae260) Thanks [@endash-shal](https://github.com/endash-shal)! - Quick Add and batch import work on a v2 PRD. A v2 tree has no levels, so
  `rex add` previews one change per description — `{ preview: true, changes }` —
  rather than the epic/feature/task proposals a v1 tree returns. The dashboard
  read only `proposals`, so the preview came back empty and there was no way to
  add a change from the dashboard at all.
  
  The preview routes now forward `changes`, and the panel renders each change
  with the placement the rules suggest and whether it lands in the Inbox.
  Accepting posts to the new `POST /api/rex/smart-add-accept`, which re-runs the
  same `rex add` with `--accept`: a v2 add is deterministic — a change's title is
  its description's first line, with no LLM round-trip — so what is written is
  what the preview named. The v1 accept path, which writes epics, features and
  tasks, is not reached.
  
  Batch import's accept path was dropping its log line and its `rex:prd-changed`
  broadcast on a v2 tree, because it looked for an `added` count in output that
  is a list of change rows. It now counts the rows.
  
  `rex add --format=json` carries each placement candidate's title and display id
  alongside its `target` id, as the text report already resolves them. Without it
  a JSON consumer has no tree to resolve the id against, and the dashboard could
  only have shown a bare id.

- [#675](https://github.com/en-dash-consulting/n-dx/pull/675) [`f049fd4`](https://github.com/en-dash-consulting/n-dx/commit/f049fd445d2a22ceff1bce210e4be43a54ec8579) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard's Adaptive and Workflow tuners now propose token budgets in the
  units the budget is enforced in, and never below the cost a run pays to
  arrive.
  
  `routes-adaptive.ts` and `routes-workflow.ts` each carried a self-contained
  copy of hench's tuners, with the defect hench's own copy had already fixed:
  `totalTokens` was `input + output`, which on a prompt-cached run is roughly a
  twelfth of what `checkTokenBudget` enforces; the high-consumption threshold
  was a fixed 100,000 in those smaller units; and no proposal was clamped to the
  measured arrival cost. Unlike hench's tuners these routes are wired into the
  dashboard, so an operator could press Apply on a budget below the context
  write every run pays — and every run afterwards would fail before doing any
  work.
  
  The counting rule, the arrival-cost floor and the two thresholds now live in
  `packages/web/src/server/token-cost.ts`, a deliberate port of hench's module
  shared by both routes. Web does not depend on hench and adding a gateway to
  reach three pure functions would be an architecture change made in passing, so
  the port stays — and `tests/e2e/token-cost-parity.test.js` drives both
  implementations over the same fixtures and fails when they disagree. hench's
  two threshold constants moved into its own `token-cost.ts` and are exported,
  so the parity test compares real values rather than a third copy of the
  literals.
  
  Adjustments are also no longer labelled "auto-applied". Nothing in the server
  writes the config — the Apply button posts `automatic: false` — but the
  notification type was `auto-applied` whenever adaptive mode was enabled, which
  is the default, presenting an unapplied number as already in force.

- [#747](https://github.com/en-dash-consulting/n-dx/pull/747) [`3a2ccdc`](https://github.com/en-dash-consulting/n-dx/commit/3a2ccdc41bacba049a8e37a60398df0916448508) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's watchers and routes hold up.
  
  - `ndx start` stays up when a file watcher errors. The sourcevision, rex, hench, dev-viewer and MCP schema `dist/` watchers had no `error` listener, so an error emitted after `fs.watch` returned (Windows raises EPERM when a watched directory is deleted, for example on a branch switch) crashed the server. Each now logs a warning, closes itself and is dropped; a failed rex PRD-folder watcher can be watched again.
  - The rex watcher follows a PRD folder (`prd_tree/`, `product/`, `changes/`) that is deleted and recreated while `ndx start` runs, so edits inside it refresh `.rex/.cache/prd.json` again without a restart.
  - `PATCH /api/rex/items/bulk` validates `updates` with the single PATCH's rules: `run`, ids, timestamps and other fields that route refuses answer 400 naming the field, and an empty title is refused, with nothing written. On a v2 project a completing bulk PATCH adds the optional `applied` and `reason` fields to an id's result when its change was held open or left unapplied under `rex.applyOn`; an applied completion stays `{id, ok: true}`. v1 is unchanged.
  - A failed refetch of the Product, capability or Changes read keeps the loaded page, and an open capability page with its Back button, under a "Could not refresh" notice instead of replacing them with an error.
  - The Ask panel's refine mode on a v2 project applies rex's change-layer merge rule when it parses a proposal, so a merge that absorbs a change carrying amendments, or that merges tasks, is skipped with rex's reason instead of being offered and then refused at apply.

- [#809](https://github.com/en-dash-consulting/n-dx/pull/809) [`cb236e9`](https://github.com/en-dash-consulting/n-dx/commit/cb236e93e169b0f10301f47ffa26e0bf681c9259) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Update `@anthropic-ai/sdk` to 0.133 (hench, llm-client) and `zod` to 4.6.7 (hench, rex, sourcevision, web). Both are additive releases with no change to n-dx behaviour.

- [#627](https://github.com/en-dash-consulting/n-dx/pull/627) [`8507518`](https://github.com/en-dash-consulting/n-dx/commit/8507518864af56e93cf8a6c2aad6c3bb9a9236a1) Thanks [@dependabot](https://github.com/apps/dependabot)! - Dev dependencies bumped, including vitest 5. No runtime change: the published packages ship the same code, and the one test that vitest 5 rejected (a `vi.mock` written inside a test body) now declares its mock at module scope.

- [#787](https://github.com/en-dash-consulting/n-dx/pull/787) [`d7c49c3`](https://github.com/en-dash-consulting/n-dx/commit/d7c49c3927f08f5743f43274034dee29f6843ecb) Thanks [@endash-shal](https://github.com/endash-shal)! - Fail-forward mode: a settings toggle that commits work as it happens instead of letting it pile up uncommitted.
  
  With it on, an autonomous loop that finds work left in the tree after an iteration commits it and carries on, rather than refusing to continue — so an interrupted loop still leaves each finished iteration committed. Settings changes commit too, including ones made from the pre-run menu, which writes the same file through the same handler as the settings page. `--allow-dirty` suppresses it: the operator asked for their tree to be left alone.
  
  Every commit it makes is scoped to the paths that step touched and uses a constant message for its kind. Work that belongs to the operator is refused outright rather than committed: anything already staged (including a `git add -p` hunk selection), and anything at all while a merge, rebase, cherry-pick or revert is in progress — `git add` on a conflicted path marks it resolved, and mid-rebase the commit then succeeds with the conflict markers in it. A failed commit unstages whatever it had staged, so it leaves the index as it found it. It also refuses to commit a config that carries a credential. Commits carry the usual `N-DX` trailers. Nothing is ever pushed. Off by default, and with it off behaviour is unchanged.
  
  The toggle is read through `isFailForwardEnabled` in `@n-dx/llm-client` rather than from the dashboard's feature registry, because `ndx work` and the hench run loop are separate processes that never reach the web server — two readers of one toggle would have drifted. The value is re-read at each decision point, so turning it off mid-run is obeyed at the next boundary rather than after a restart.
  
  The toggle also carries an info control on the settings page explaining what is committed and when; `FeatureDefinition` gains an optional `details` field for toggles whose effects reach outside the dashboard.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`3f50210`](https://github.com/en-dash-consulting/n-dx/commit/3f50210529ca205d7791cb798ade0162faf8debc) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Review is now a project setting: `hench.review.mode` (`off`, `self`, `pair`;
  default `off`), `hench.review.vendor` (`claude` or `codex`; unset means the
  other one) and `hench.review.rounds` (1-3, default 2). `self` runs the review
  pass exactly as `--review` does; `--review`, `--no-review` and a task's saved
  `run.review` still win. `pair` is recognised but pair review is not built yet,
  so it runs no review and says so — it never falls back to self review. Pair
  mode is refused when the reviewer is the executor's own vendor, the executor is
  not claude or codex, or the provider is `api`. `ndx config` rejects values
  outside those sets, and `ndx work --resolve` reports the three settings under
  `review`, each with the key that supplied it.

- [#741](https://github.com/en-dash-consulting/n-dx/pull/741) [`f0148e7`](https://github.com/en-dash-consulting/n-dx/commit/f0148e7462961b31a962677bc6310adec66438b1) Thanks [@endash-shal](https://github.com/endash-shal)! - Report a run's loop position and the hub's queued requests on `GET /api/live`
  
  The Live overview could list a `--loop` run but not say where in the chain it
  was, and it counted the execute requests the hub had queued without naming any
  of them.
  
  Hench now records the position on the run record at run start
  (`RunRecord.loop`: the mode, the 1-based iteration and, for `--iterations=N`
  alone, the planned total), so a run reports its place while it is still going
  rather than only once it ends. A run started on its own carries no loop block —
  "1 of 1" would be a loop that does not exist. `GET /api/live` exposes it as
  `runs[].loop`.
  
  The queued requests reach the project server through the admission header the
  hub's proxy already sets on every `/api/live`, narrowed to the project being
  proxied the same way `GET /api/hub/queue` narrows under `/p/<id>/`. They are
  laid over the cached snapshot as `queue.queued`, named from the PRD index the
  answer already holds, so the request does no extra I/O and stays as fast as its
  cache makes it. The counts beside the list stay machine-wide, so a project
  waiting behind another project's run still sees why.

- [#741](https://github.com/en-dash-consulting/n-dx/pull/741) [`24a3554`](https://github.com/en-dash-consulting/n-dx/commit/24a3554d4ff4403f429018fb2164f1bbdfd56937) Thanks [@endash-shal](https://github.com/endash-shal)! - Turn the Live task page into the run summary once the selected run finishes.
  At the same `/live/task/:taskId` URL a Summary tab appears and opens by
  default, showing the run's closing words, what the work changed, what the
  reviewer found and what was done about it, the run metrics (wall time, turns,
  retries, tool calls, tokens by class, estimated cost, files changed) and the
  commits it landed — all read from `GET /api/hench/runs/:id`, the route the
  Work view already uses. Actions: Re-run (the page follows the new run), Open
  commit, and Capture follow-up to the PRD. Work, Log and Review stay available,
  and an explicit tab click is never overridden.
  
  The viewer's commit-link building moves to `viewer/utils/commit-link.ts`, now
  shared with the PRD tree's commits table, which also fixes the dead link that
  table produced for an scp-style (`git@host:owner/repo`) remote.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`0562de4`](https://github.com/en-dash-consulting/n-dx/commit/0562de42cb52dda567b9b1358d987e380519b51a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `POST /api/llm/config/preview` resolves unsaved edits without writing them. It
  takes `PUT /api/llm/config`'s body, plus an optional `provider` (the field the
  page saves through `/api/hench/config`), and returns `effective`,
  `effectiveProblems`, `tiers`, `failover` and `review` for the saved config with
  those edits applied in memory. Refused edits come back in `editProblems`
  instead of failing the request. `GET` and the preview now share one resolver;
  `@n-dx/llm-client` exports `parseLLMConfig`, the in-memory half of
  `loadLLMConfig`.

- [#715](https://github.com/en-dash-consulting/n-dx/pull/715) [`ec4cd53`](https://github.com/en-dash-consulting/n-dx/commit/ec4cd5313e430f27b93b38ca5ad643577d3852bc) Thanks [@endash-shal](https://github.com/endash-shal)! - Edit the product map directly, and set the two PRD settings from the dashboard.
  
  **Direct edit, with an editorial checkbox.** The capability page can now edit a
  node's spec in place. The checkbox is the point: checked, it says the wording
  moved and nothing was asked for, so the node stays met and the edit is recorded
  as history; unchecked, the spec has moved ahead of the build and a change is
  drafted to build the difference. Only the author can tell those apart, so the
  form asks rather than guessing — and names which of the two is about to happen
  before the edit is submitted. The checkbox is disabled, with the reason beside
  it, on a node rex would refuse it for: one already revised (re-stamping would
  mark the unbuilt revision met) or one never met (there is no met spec to
  re-stamp). Inherited criteria are not editable here, because they belong to the
  capability they come from. The page submits the edit and renders the capability
  it is handed back; what an edit does to a node's status stays rex's to decide.
  
  **Workflow settings.** `rex.applyOn` (when a completed change's amendments
  reach the product layer) and `rex.placement.autoAccept` (when a placement is
  taken without a person) are now on the Workflow page, saved to the same
  `.n-dx.json` the CLI reads. What counts as valid is rex's to say, not the
  dashboard's: `APPLY_ON`, `PLACEMENT_AUTO_ACCEPT`, both defaults and both
  parsers now come through the web→rex gateway, so the chooser offers exactly the
  values the parser accepts and `PUT /api/rex/settings` refuses anything else. A
  chooser with its own list would write a setting the CLI silently falls back
  from, which reads as a save that did nothing. For the same reason the page
  surfaces rex's own warnings about values already in the file that it had to
  fall back from.
  
  **Bitbucket remotes.** The dashboard's repository name is read through the
  shared remote-URL parser rather than a local regex, so Bitbucket Cloud and Data
  Center remotes — including the `/scm/` clone prefix and the ssh-on-7999 form —
  resolve as the analysis manifest and the iso export already resolve them. The
  local copy answered correctly for the common forms; what it could not do was
  guarantee it answered the *same* thing, which is the whole reason the parser is
  shared. Covered by tests over every form the route can be given, and over a
  real Data Center remote read from a git checkout.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`a19f176`](https://github.com/en-dash-consulting/n-dx/commit/a19f1763d2d609be1957a1562f7083ef785a62bc) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Pair review now runs end to end. With `hench.review.mode: "pair"`, the other
  vendor's CLI reviews the diff and reports; must-fix findings resume the
  executor's session to fix them, up to `hench.review.rounds`, and lesser findings
  are captured to the PRD. `GET /api/llm/config` reports `review.pairSupported:
  true`, so Robot Wrangler enables the Pair card. The review modes are documented
  in the configuration guide.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`323ceca`](https://github.com/en-dash-consulting/n-dx/commit/323ceca26bf13747a83dfc71007e6c013fc91191) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `hench.review.mode: "pair"` now reviews. After a task validates, the other
  vendor's CLI starts a fresh session, reads the task, the changed files and the
  diff, edits nothing, and writes the findings report. The review runs on
  `llm.<reviewer>.reviewModel`, then `llm.reviewModel`, then the vendor default,
  and the run record carries `mode: "pair"`, the reviewer vendor and model. Until
  the fix loop lands, every finding, must-fix included, is captured or queued and
  the commit is not blocked. A reviewer CLI that is missing or signed out skips
  the review with a warning under `--review-optional`, as before.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`678d5ac`](https://github.com/en-dash-consulting/n-dx/commit/678d5ac1265ef761558b2a8111da944ef869ed70) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Prepare task modal replaces the Adversarial review On/Off switch with a Review field (Off, Self or Pair) and adds a Reviewer vendor field, each showing its resolved default and source. Save writes `reviewMode` and `reviewVendor` into the task's run block, and the copied `ndx work` line carries `--review-mode` and `--reviewer`. Pair is disabled while `GET /api/hench/prep/:taskId` reports `pairSupported` false; the route now reports it.

- [#627](https://github.com/en-dash-consulting/n-dx/pull/627) [`00e7462`](https://github.com/en-dash-consulting/n-dx/commit/00e74627b65fe3bcc453d4330ef5d9969b82d177) Thanks [@dependabot](https://github.com/apps/dependabot)! - Production dependencies bumped: zod 4, ink 8, react 19.3, @anthropic-ai/sdk 0.131, @modelcontextprotocol/sdk 1.32.1 and pdfkit 0.20. TypeScript stays on 6.x because sourcevision parses source with its compiler API, which TypeScript 7 does not ship, and preact stays on 10.x until its web test and leave-guard changes are worked through. Schemas move to zod 4's two-argument `z.record`; reserved and loosely-typed state keys are declared optional, since zod 4 no longer treats a missing `z.unknown()` key as optional; and the SDLC evidence list keeps its at-least-one rule as a tuple so it still infers the non-empty type.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`c2e4fe7`](https://github.com/en-dash-consulting/n-dx/commit/c2e4fe71e4af63c58a64c4b2a1a45c167e27458e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Redesigned the Robot Wrangler settings page as five sections (Vendor,
  Connection, Models, If a run fails, Review) with a run card beside them. Local
  gets its own Server section with profile chips and a connection test that
  reports the model count. The save bar now says what will change and offers
  Discard. The vendor cards drop from four columns to two under 768px, and tier
  rows and review cards stack under 640px.

- [#787](https://github.com/en-dash-consulting/n-dx/pull/787) [`60a920a`](https://github.com/en-dash-consulting/n-dx/commit/60a920aa1bd8e33d68e8bc083a174d88d496a42d) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard can start the project's dev server or a build, and hands you the link when it serves.
  
  A new control in the bottom bar appears when `npm run dev`, `python3 main.py`, `cargo run`, `go run .`, a Makefile target or similar is detected from the project's own manifests — using the package manager the lockfile implies, not an assumed one. A dropdown lists every detected run and build command, a spinner runs while the command does, and the result reports success, failure or a stop.
  
  When the process announces a localhost URL the port is read from what it actually printed — dev servers choose a port at runtime and move when one is busy — and surfaced as a link. A wildcard bind is shown as localhost, which is what a browser on the machine can open.
  
  Commands are run by id from the server's own detected list, and that is the only thing the route accepts — no binary, and no extra arguments. Without a shell an argument is only ever one literal argv entry, which is true and beside the point: flags are the attack surface, and `make --eval` or `cargo --config build.rustc-wrapper` execute an arbitrary program on their own. The package manager is likewise taken from an allowlist rather than from the repo's `packageManager` field, which is untrusted checkout content. Spawning goes through `spawnCli` so Windows `.cmd` shims launch correctly, and Stop tree-kills, which is what reaches a dev server running underneath a shim instead of orphaning it with the port still held.
  
  A run has no timeout, because a dev server is supposed to stay up; a build gets a ten-minute ceiling. One command runs at a time per workspace, and the dashboard's shutdown sequence terminates anything still running so a dev server is not orphaned with its port held.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`b0f94fd`](https://github.com/en-dash-consulting/n-dx/commit/b0f94fda920907512fc743d3b3cb17bd639629d2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Robot Wrangler replaces the agent, project and light model fields with a tier table: one row per tier the server resolved (Agent model, Standard, Light, Heavy, and Free when set), each showing what uses it, a model select and where the model comes from. Heavy and Free save `llm.tiers.<vendor>.heavy` / `.free`; clearing a row removes its key.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`974ce1d`](https://github.com/en-dash-consulting/n-dx/commit/974ce1d4498a923c80c66b2d002f678383e714bd) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Robot Wrangler shows the vendor as four selectable cards, each with the catalog's readiness summary, and the provider as connection cards (one per catalog provider, or a single fixed card when the vendor offers one). Arrow keys move the selection; saving writes the same keys as before.

- [#787](https://github.com/en-dash-consulting/n-dx/pull/787) [`2740c0c`](https://github.com/en-dash-consulting/n-dx/commit/2740c0c41c30b48af4602ccc30278ba678552801) Thanks [@endash-shal](https://github.com/endash-shal)! - The git panel can commit a tree of generated files in one click, and optionally without being asked.
  
  `GET /api/git/status` now reports where each dirty file came from — the PRD tree, SourceVision scan output, or the user's own work — classified from the project's own layout rather than hardcoded `.rex` / `.sourcevision` spellings, so a v2 project under `.ndx/` classifies correctly. When every dirty file shares one origin the response says so, and the panel offers a labelled one-click commit with a constant message.
  
  `POST /api/git/commit` takes an optional `scope`. A scoped commit re-reads `git status` server-side and derives the paths itself rather than trusting anything from the caller, refuses with 409 if the tree is no longer homogeneous (naming the unexpected files), and stages and commits by pathspec. Without a scope the route behaves exactly as before. This matters because the existing path runs `git add -A`, which cannot express "only the PRD files".
  
  A new `git.autoCommitGenerated` toggle, off by default, does the same thing unattended via the `useAutoCommitGenerated` hook. The server re-checks the toggle on every automatic request and refuses with 403 when it is off, so a stale client cannot commit on its own. Nothing is ever pushed, and a tree containing any of the user's own work is never touched.
  
  This is the plumbing the "fail-forward mode" feature builds on.

- [#787](https://github.com/en-dash-consulting/n-dx/pull/787) [`c9a4ce2`](https://github.com/en-dash-consulting/n-dx/commit/c9a4ce25124401c995c1e57c86a67d2f8199e4b0) Thanks [@endash-shal](https://github.com/endash-shal)! - The settings overlay no longer has the page beneath it painting over the top. Opening PRD settings from the work page showed that page's text and controls sitting over the modal.
  
  The overlay was at a bare `z-index: 60` while the status trays, banners and toasts that render as its siblings sat between 100 and 10001 — and because the page below stays mounted when settings opens, all of it kept painting. Every component had picked its own number and nothing compared them, so the conflict was invisible.
  
  App-level stacking is now one `--z-*` scale in `styles/tokens.css`, from the header up through trays, banners, toasts, page-owned dialogs, full-page overlays, shell dialogs, crash recovery and the accessibility skip link. The overlay sits above everything a page can render, while a dialog opened from inside it — the unsaved-changes prompt — still sits above the overlay. Local stacking inside a single component is deliberately not part of the scale.
  
  Two orderings that were easy to lose are kept explicitly: the memory warning stays above the degradation banner, and crash recovery stays reachable above a stuck overlay.
  
  A new test reads the real stylesheets and fails if any of those relationships inverts, or if an app-level layer goes back to a raw number.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`1e56738`](https://github.com/en-dash-consulting/n-dx/commit/1e567383db94768b4377d58a8b0b6cc79c5de73b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Settings pages render immediately instead of waiting for the analysis data to load, so Robot Wrangler, Project, Workflow and Commands no longer sit blank on a busy repository. Robot Wrangler's stylesheet now uses the dashboard's defined design tokens, which restores its spacing, surfaces and the Automatic failover toggle track. A test now fails on any undefined design token used without a fallback.

- [#645](https://github.com/en-dash-consulting/n-dx/pull/645) [`93004a6`](https://github.com/en-dash-consulting/n-dx/commit/93004a6d35735109c42a32ca55ce5e4e214edb25) Thanks [@endash-shal](https://github.com/endash-shal)! - Opening the URL `ndx start` prints no longer answers a bare "Not found" once the browser already holds the `ndx_token` cookie. Both token gates (hub and project server) now redirect a navigation carrying `?ndx_token=` to the clean URL whether or not the request is already authenticated, so the token never stays in the address bar; and the static route matches on the pathname, so `/?anything` serves the dashboard instead of falling through to the 404.

- [#662](https://github.com/en-dash-consulting/n-dx/pull/662) [`2f124e3`](https://github.com/en-dash-consulting/n-dx/commit/2f124e378f0e63471d5d44e1cd5f241e25698dfe) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The run block gains reviewMode and reviewVendor; add_item and edit_item accept them. A task can now be pair-reviewed by a chosen vendor whatever the project default is. `ndx work` takes `--review-mode=<off|self|pair>` and `--reviewer=<claude|codex>`, and applies them as flag, then the task's `run`, then `hench.review.*`, then the default. A saved value the run cannot honour (a reviewer equal to the executor, or pair on an executor with no CLI counterpart) is skipped with a warning and never stops a loop. `ndx work --resolve` reports `reviewMode` and `reviewVendor` under `resolved`, each with its source, and `review` now holds only `rounds`.

- [#694](https://github.com/en-dash-consulting/n-dx/pull/694) [`d0398e5`](https://github.com/en-dash-consulting/n-dx/commit/d0398e50aa2749b6384d3e5e9f4b5a602b80d73d) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: fixture git repositories take their identity, line-ending and signing config from one gitconfig that the shared vitest setup writes and points `GIT_CONFIG_GLOBAL` at, instead of two to five `git config` spawns per repository. hench's `initGitFixtureRepo` is now a bare `git init`. No production code changed.

- [#694](https://github.com/en-dash-consulting/n-dx/pull/694) [`8228a7e`](https://github.com/en-dash-consulting/n-dx/commit/8228a7eb48c34ea6eb394a1b56d2736c7e759553) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: each package's vitest config splits its files into a shared-worker project and an isolated one for files that mock modules or globals, through `tests/vitest-isolation.mjs`. Same tests, less per-file worker and module-graph cost. No production code changed.

- [#694](https://github.com/en-dash-consulting/n-dx/pull/694) [`173f13e`](https://github.com/en-dash-consulting/n-dx/commit/173f13e17743c32f839c1619fc221e7d8c584148) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: vitest keeps console output for failing tests and drops it for passing ones (`silent: "passed-only"`). A green run of the monorepo no longer prints thousands of lines of task briefs, init summaries and fixture warnings. No production code changed.

- [#675](https://github.com/en-dash-consulting/n-dx/pull/675) [`7a6eeab`](https://github.com/en-dash-consulting/n-dx/commit/7a6eeabfe2a97d511ebbc980f0e1155134e88d48) Thanks [@endash-shal](https://github.com/endash-shal)! - Count each assistant message's tokens once, and price a task's runs in the dashboard.
  
  Claude's `--output-format stream-json` emits one `assistant` line per *content block*, not per message, and every line repeats the finished message in full — `usage` included. A turn that writes a sentence and calls three tools arrives as four lines carrying one turn's tokens four times. Claude Code's session transcripts have the same shape. Both of hench's live ingestion paths summed line by line, so every run's totals were multiplied by the turn's average block count: on a measured session, 234 usage-bearing lines carrying 57 distinct messages, a 4.27x over-count that recorded 23.5M cache-read tokens against the 5.5M actually read.
  
  `UsageMessageFilter` in `@n-dx/llm-client` holds the identity rule — the first sighting of a `message.id` counts, later ones do not. It is applied in `cli-loop`'s token extraction (both the event-pipeline and legacy paths) and in the transcript reader behind `hench record`. Repeats are flagged rather than dropped in the transcript, because cursors and marks address positions by the per-line uuid; removing lines would move every boundary and invalidate every cursor file on disk. Usage carrying no message id is still counted — a vendor that stamps none would otherwise lose its tokens entirely.
  
  The dashboard then had a second problem: it led with a single token total that counted cache reads alongside everything else. Cache reads bill at roughly a tenth of the input rate and outnumber the other three classes by an order of magnitude, so the figure read as tens of millions for work that cost a few dollars. The per-task aggregator now keeps the four billed classes apart instead of collapsing them to one number, and prices each run at the model that run recorded — one task's Haiku and Opus runs are no longer billed at a single blended rate. Cost rolls up through the PRD tree alongside tokens, and the tree's usage column leads with it; the token accounting moves to the cell tooltip, which reports newly-processed tokens and cache reads separately so the price and the token count can be reconciled.
  
  Two errors in the price table itself turned up on the way. `claude-sonnet-5` was priced at $3/$15 — the rates of the Sonnet 4.6 it replaced — overstating every Sonnet 5 figure by 50%; it is the toolkit's standard tier *and* the fallback every unrecognised model is priced at, so the error reached far more surfaces than the runs that named it. And `claude-fable-5-1` was absent, so a Fable 5.1 run silently priced at the Sonnet fallback; its cache-read rate is $0.25/MTok rather than the 0.1x the other Claude rows follow.
  
  Runs already recorded keep the totals they were written with — the run files do not retain message ids, so the over-count cannot be undone after the fact. Runs recorded from here on are correct.

- [#746](https://github.com/en-dash-consulting/n-dx/pull/746) [`3256c61`](https://github.com/en-dash-consulting/n-dx/commit/3256c61b794c6f14636f17050716480316da7435) Thanks [@dnaniel](https://github.com/dnaniel)! - Icon-only action buttons in the dashboard draw a shared SVG icon sized by one token (16px) instead of a Unicode glyph sized by each button's font. The Next Steps copy button (`⎘`, which rendered a few pixels tall) shows a copy icon that turns into a check once copied, with a 28px click target, and the close (`✕`/`×`) and more (`⋯`) buttons across the viewer use the same icon set.

- [#715](https://github.com/en-dash-consulting/n-dx/pull/715) [`35dffa3`](https://github.com/en-dash-consulting/n-dx/commit/35dffa3cc8056accb32fabc529716f69f326f9d5) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard renders a v2 project without breaking. v1 is unchanged.
  
  - `ndx start` builds the PRD cache from rex's change-layer projection, and its watcher follows `product/` and `changes/`, including when they are created after start. The task list, Live and the merge graph now show titles instead of "No PRD data found".
  - `POST /api/rex/items` (Quick Add) creates a change in the Inbox through the change-layer store and ignores the v1 `level`. A `type` other than absent or `change` (capability, task, subtask) is refused with a reason and writes nothing, and so is a `parentId`; the reason points to `rex add --type=<type> --parent=<id>` or MCP `add_item`.
  - `PATCH /api/rex/items/:id` and `PATCH /api/rex/items/bulk` with `status: "completed"` go through rex's v2 completion, so a change's amendments reach the product layer. Every other status goes through the change-layer store. In a bulk update a change listed before its own tasks is completed after them, and a completion rex refuses reports `ok: false` with its `error`. A completing PATCH that also carries fields completes first and writes the fields only if rex accepted it, so a refused completion saves nothing; if the fields are refused after the completion was saved, the error says the item was completed.
  
  - `GET /api/rex/backups` and `POST /api/rex/restore` answer 409 on a v2 project, instead of listing v1 snapshots or splitting the tree with one. Rex's refusal wording is the `error`.
  - On a v2 project, merges follow rex's change-layer rule, the one MCP `merge_items` applies. This covers `POST /api/rex/items/merge` (preview included), the merges accepted through `POST /api/rex/apply-refinements`, and `GET /api/rex/reorganize` with `POST /api/rex/reorganize/apply`. Only sibling changes merge. A change that carries amends is never absorbed. The absorbed change's touches move to the target, and its id, display id and aliases become the target's aliases. A refused merge answers 400 with rex's reason and writes nothing; a refused refinement merge reports `invalid` with that reason. Reorganize on v2 does not propose the v1 orphan move or single-child collapse.
  - The Product and Changes views are on the Plan page, fed from rex's v2 model: the product map with rex's computed status and health and the open changes against each capability, a capability's page with its criteria and the applied changes that moved it, and changes grouped by planned release and stage. On a v1 project both say to run `ndx migrate`. They refetch on `rex:prd-changed`, so they follow the Tasks tree after a Quick Add or an applied change without a reload.
  
  Fields added to an `/api` route on a v2 project: new read routes `GET /api/rex/product` (`{ layout, map }`), `GET /api/rex/changes` (`{ layout, changes }`) and `GET /api/rex/product/capability/:id` (`{ layout, capability }`, 404 for an id naming no live capability); on a v1 project each answers `{ layout: "v1" }`. Both restore routes answer `409 { ok: false, code: "V2_RESTORE_REFUSED", error }`; the `POST /api/rex/items` response carries `type: "change"` and `needsPlacement: true`, and no `level`.
  
  A change completed under `rex.applyOn` `review` or `release` is no longer shown as in progress. v1 is unchanged.
  
  - `GET /api/rex/changes` (and the open-change overlays on `GET /api/rex/product` and the capability history) report `stage: "awaiting-apply"` for a change that is completed but not applied. The Changes view lists it between In progress and Applied as "Waiting for a steward to apply it". Soft freeze: `stage` gains the value `awaiting-apply`; the other five values are unchanged.
  - `PATCH /api/rex/items/:id` with `status: "completed"` on a v2 project answers `{ ok: true, applied, reason }` when rex held the change open or left it unapplied, with rex's `reason`. When nothing was held the answer is still `{ ok: true }`. Soft freeze: `applied` and `reason` are new optional fields.
  
  `GET /api/rex/product/capability/:id` says whether the capability was ever met and whether its spec moved since, so a client can decide editorial eligibility without reading the display status (`changing` outranks `revised` and `proposed`). Soft freeze: `met` (`metAt` is recorded) and `specChangedSinceMet` (`metAt` is recorded and the spec no longer hashes to it) are new required booleans on `capability`.

- [#782](https://github.com/en-dash-consulting/n-dx/pull/782) [`15e6b65`](https://github.com/en-dash-consulting/n-dx/commit/15e6b654ab11a4bd4042e03dae0fe0f1ac76c2e3) Thanks [@dnaniel](https://github.com/dnaniel)! - The Analysis page is a dashboard. The codebase map takes the top-left two thirds across three rows, with Codebase health and Next steps beside it; Problems, Suggestions, Zones, Architecture (with Routes), Files, Languages, and the gated PR markdown and Ask follow in aligned rows of three. Each tile shows a compact summary built from the loaded analysis — severity counts and the worst findings, the largest zones' share, file totals by role — and its header opens it as a modal over the dashboard — inset on a dimmed backdrop under a "← Analysis / Tile" trail, closed by the backdrop, the trail, Esc or its close button — beside the detail panel when an item is open. The Terrain section is gone; the flat repository map keeps its own page.
  
  The Analysis header is one block: the title, a status line under it (branch, commit, analysis age, and a four-step enrichment meter whose tooltip notes a pass reset), and a single split Re-analyze button whose menu holds Full analysis and an Include sub-packages switch — no emoji, no bare checkbox.
  
  Smaller fixes: finding cards lose their stray list bullets; the floating status pills (sessions, uncommitted files, running operations, refresh queue) share one bottom-right dock and open their panels above themselves instead of overlapping; archetype cells in the Files table look like the select they become; and every select leaves room for its arrow.
  
  The breadcrumb row is gone. The project name — a project menu behind a hub with several projects, after a Hub link — and the worktree · branch chip sit in the top bar, with the page's guide beside search; each view's own page is titled by the shell.

- [#715](https://github.com/en-dash-consulting/n-dx/pull/715) [`097c06f`](https://github.com/en-dash-consulting/n-dx/commit/097c06f9cfe1a7ec87493e7cdf519f17d2acc08d) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard reads a node's **type**, not v1's `level`. Schema v2 replaced
  `level` (epic/feature/task/subtask) with `type` (area/capability/constraint/
  change/task/subtask), and both storages are live, so the two vocabularies had
  to coexist somewhere rather than everywhere.
  
  `src/shared/item-type.ts` is now the one module in the package that reads a v1
  `level` — `itemTypeOf(item)` prefers `type` and falls back to `level` — and the
  one that writes one, through `levelOf(type, parentType)`. Every route, view,
  component and hook keys on `ItemType` instead. The vocabulary is the union of
  both versions on purpose: a v1 item reads as its own level and a v2 node as its
  own type, because collapsing epic and feature onto `change` at read time would
  relabel every epic in a v1 PRD, and that collapse belongs to the migration.
  
  `POST /api/rex/items` accepts `type`, infers it from the parent when it is
  absent, and still accepts `level` as the v1 spelling. It refuses a
  product-layer type with the reason — the store behind it is v1 and has no level
  to write one as — rather than silently filing it as an epic. The add, delete,
  prune, requirements, validation, search, live and merge-graph payloads carry
  `itemType` where they carried `level`; the add and delete responses still carry
  `level` alongside it.
  
  Net removals rather than additions: the viewer's own level hierarchy
  (`prd-tree/levels.ts`), six copies of a level-label map, two emoji tables and
  three parent/child tables are gone. The local hierarchy had already drifted —
  it said a subtask holds nothing, where rex says it holds a subtask — and
  `tests/unit/shared/item-type-contract.test.ts` now pins the mirror against
  rex's own tables so it cannot drift again. With the level system no longer
  reached from routes, `isItemLevel`, `isRootLevel`, `isWorkItem`,
  `LEVEL_HIERARCHY` and `CHILD_LEVEL` leave the web→rex gateway.
  
  A capability's criteria are labelled "Capability criteria" and a work item's
  acceptance criteria "Done when", per the 2026-10-08 terminology decision.
- Updated dependencies [[`02aa8af`](https://github.com/en-dash-consulting/n-dx/commit/02aa8afe08842e6d56b65f52d3364007485b72c2), [`550c099`](https://github.com/en-dash-consulting/n-dx/commit/550c099f0e81cb18b20d3fecd619d549bf4d2f61), [`3049ac5`](https://github.com/en-dash-consulting/n-dx/commit/3049ac5ae0199c06b262d0bec554d0c6931db497), [`26d68a9`](https://github.com/en-dash-consulting/n-dx/commit/26d68a9c6bdbe1de498b43a777d517e75e1caecf), [`0fa0251`](https://github.com/en-dash-consulting/n-dx/commit/0fa0251bb16de71d69aabbe9243a86bf2325dadb), [`f0ca395`](https://github.com/en-dash-consulting/n-dx/commit/f0ca3954254f56bd20611e14459f607dc6181ff9), [`02eed9a`](https://github.com/en-dash-consulting/n-dx/commit/02eed9a6fa283936ae81862c213be3d4ee323b0a), [`1923d4d`](https://github.com/en-dash-consulting/n-dx/commit/1923d4d06a947f1d6b296acbf7418e694c304cad), [`1abeb88`](https://github.com/en-dash-consulting/n-dx/commit/1abeb885cd14a6a61222aa5073e2700fa78ae260), [`cb236e9`](https://github.com/en-dash-consulting/n-dx/commit/cb236e93e169b0f10301f47ffa26e0bf681c9259), [`8507518`](https://github.com/en-dash-consulting/n-dx/commit/8507518864af56e93cf8a6c2aad6c3bb9a9236a1), [`d7c49c3`](https://github.com/en-dash-consulting/n-dx/commit/d7c49c3927f08f5743f43274034dee29f6843ecb), [`0a08ba6`](https://github.com/en-dash-consulting/n-dx/commit/0a08ba6ac46544418a8666bcd971de1c9450374f), [`2cd2e40`](https://github.com/en-dash-consulting/n-dx/commit/2cd2e40b5927eb23a9633aaddc37bbce559c3101), [`a4af06e`](https://github.com/en-dash-consulting/n-dx/commit/a4af06ec00bfd0fd8ed37bed21cf04885a99dc62), [`090e111`](https://github.com/en-dash-consulting/n-dx/commit/090e111efc45edac8a0bcdf420fd55b2baabc117), [`5ef4660`](https://github.com/en-dash-consulting/n-dx/commit/5ef4660a3d53c49946aa396c54c2dee20af7d920), [`17257ac`](https://github.com/en-dash-consulting/n-dx/commit/17257acdcd976fae362ee09488bc2ddebebe2992), [`4aae21c`](https://github.com/en-dash-consulting/n-dx/commit/4aae21c613d532b56a3b62fce0f362075110e4fa), [`ffe0774`](https://github.com/en-dash-consulting/n-dx/commit/ffe0774afe9ca7e2344624d9516a4cdb70536899), [`06082f8`](https://github.com/en-dash-consulting/n-dx/commit/06082f8eb52ff8efcd03fa00f95aa098028a5a62), [`0562de4`](https://github.com/en-dash-consulting/n-dx/commit/0562de42cb52dda567b9b1358d987e380519b51a), [`ec4cd53`](https://github.com/en-dash-consulting/n-dx/commit/ec4cd5313e430f27b93b38ca5ad643577d3852bc), [`3e6c353`](https://github.com/en-dash-consulting/n-dx/commit/3e6c353d31a11130b1bef37419b45c6458080e76), [`ee868a7`](https://github.com/en-dash-consulting/n-dx/commit/ee868a76f8d4b3f84183267b56d2c32fe959c66e), [`dc0ba79`](https://github.com/en-dash-consulting/n-dx/commit/dc0ba79f4e48dae6b7d803d201bdcb69602f2023), [`7964dc2`](https://github.com/en-dash-consulting/n-dx/commit/7964dc2f3c762f6f4aa77fc548f94bef3653ed3d), [`00ba308`](https://github.com/en-dash-consulting/n-dx/commit/00ba308ecb4ae783cdf4837686f3f8338ede1c0e), [`3b4978e`](https://github.com/en-dash-consulting/n-dx/commit/3b4978ec0d50d08b56b93996a565f7cc148efd43), [`df54b01`](https://github.com/en-dash-consulting/n-dx/commit/df54b0162a38250827499fd1f545dd4689dc2505), [`5032a7c`](https://github.com/en-dash-consulting/n-dx/commit/5032a7c9ff4346c62fc8898a32d7183d8cdc3f6d), [`5292bdb`](https://github.com/en-dash-consulting/n-dx/commit/5292bdb577c696e8ed05a9a2de2cf42b9d3b13fb), [`65731af`](https://github.com/en-dash-consulting/n-dx/commit/65731afcf429ea011d2bb1ee4e5f537a6739b0e4), [`8c6112e`](https://github.com/en-dash-consulting/n-dx/commit/8c6112e3182b7d624b8fc2ee6dbb84b411e203f7), [`e5b9066`](https://github.com/en-dash-consulting/n-dx/commit/e5b90660d44136bc568935a636703065933c7b04), [`91d20ad`](https://github.com/en-dash-consulting/n-dx/commit/91d20ad509f252d9d17f8128f1f2e5b8f3543609), [`1ffe0ca`](https://github.com/en-dash-consulting/n-dx/commit/1ffe0cae40b67858122ab14d26cdcb8b934afb22), [`fa4d7e9`](https://github.com/en-dash-consulting/n-dx/commit/fa4d7e903e9a59a3549f98678483b49dceeb6c45), [`00e7462`](https://github.com/en-dash-consulting/n-dx/commit/00e74627b65fe3bcc453d4330ef5d9969b82d177), [`70f49fa`](https://github.com/en-dash-consulting/n-dx/commit/70f49fa920586f70243c1089d33c5394e33f9f6e), [`085b63d`](https://github.com/en-dash-consulting/n-dx/commit/085b63d208f9622328efd5ac6f2af18ca07c2846), [`32e9aea`](https://github.com/en-dash-consulting/n-dx/commit/32e9aea4d296c7c799e880adfccfeaf055a97d2d), [`35a5632`](https://github.com/en-dash-consulting/n-dx/commit/35a5632bc20dbb8e80d186330aad55395f2591b5), [`039ee0c`](https://github.com/en-dash-consulting/n-dx/commit/039ee0c79a06fb4786790f233b79a1a53628ef4b), [`9b5f740`](https://github.com/en-dash-consulting/n-dx/commit/9b5f7404da93f402fb75bae6b0da0556909e63a5), [`f0a4b80`](https://github.com/en-dash-consulting/n-dx/commit/f0a4b802eb0e435afea4466de0e5af56cf7b73c3), [`6e87f37`](https://github.com/en-dash-consulting/n-dx/commit/6e87f37a3943094dcf596e268b28c553be04cf1a), [`4ffc297`](https://github.com/en-dash-consulting/n-dx/commit/4ffc29701453ef5e59ffa7d81d42c8be744b37f6), [`b05a659`](https://github.com/en-dash-consulting/n-dx/commit/b05a6599554b5d7893b6735f16c01636c573f04d), [`5dbf308`](https://github.com/en-dash-consulting/n-dx/commit/5dbf3086350e1530202ba7ea565400a5f5384290), [`4670da7`](https://github.com/en-dash-consulting/n-dx/commit/4670da73c3a43fb2616b0ed5f5d477373fff81e6), [`61954d9`](https://github.com/en-dash-consulting/n-dx/commit/61954d9dcdbf09d5d9f1899e4059ef22e0f657f1), [`0316a48`](https://github.com/en-dash-consulting/n-dx/commit/0316a48dc8cead39507ed79811a0a0fcba6a2775), [`23cb6f3`](https://github.com/en-dash-consulting/n-dx/commit/23cb6f36f4c3dcd33713c4201e58a8d5daa15291), [`4448fe4`](https://github.com/en-dash-consulting/n-dx/commit/4448fe4bfd8822e722e4548f66e947a3fb91d306), [`0c0c861`](https://github.com/en-dash-consulting/n-dx/commit/0c0c861564998e76cc0b51a602cd95956a6fb4db), [`e0ba4ae`](https://github.com/en-dash-consulting/n-dx/commit/e0ba4aeac84bb4ac6f6ec33334f469ba50c85c5b), [`27babd6`](https://github.com/en-dash-consulting/n-dx/commit/27babd637fe4677309053a15db9efc7b16743bce), [`57b79b5`](https://github.com/en-dash-consulting/n-dx/commit/57b79b5facab35ec2d0529b3f5a598d8321d086d), [`9edf876`](https://github.com/en-dash-consulting/n-dx/commit/9edf8765d3b822e9cd93597900682af894bfb5fe), [`273148b`](https://github.com/en-dash-consulting/n-dx/commit/273148b94449bd07dd5e299d8480d3e2f94bc933), [`c8c81b2`](https://github.com/en-dash-consulting/n-dx/commit/c8c81b2d3741448f67bafb995134c2706dbd6aab), [`a23735c`](https://github.com/en-dash-consulting/n-dx/commit/a23735ccadf4deade1eb3280be4da2c9aa8f58e3), [`e605e9f`](https://github.com/en-dash-consulting/n-dx/commit/e605e9f3bf02b0d724ea72b7818d2f4533b195bb), [`2f124e3`](https://github.com/en-dash-consulting/n-dx/commit/2f124e378f0e63471d5d44e1cd5f241e25698dfe), [`d0398e5`](https://github.com/en-dash-consulting/n-dx/commit/d0398e50aa2749b6384d3e5e9f4b5a602b80d73d), [`7be556b`](https://github.com/en-dash-consulting/n-dx/commit/7be556b29f11a83557c1a704240f6e2838a8072e), [`8228a7e`](https://github.com/en-dash-consulting/n-dx/commit/8228a7eb48c34ea6eb394a1b56d2736c7e759553), [`173f13e`](https://github.com/en-dash-consulting/n-dx/commit/173f13e17743c32f839c1619fc221e7d8c584148), [`bf98c36`](https://github.com/en-dash-consulting/n-dx/commit/bf98c36b8d80364c2a745ff3d2594349be9fa7ae), [`7a6eeab`](https://github.com/en-dash-consulting/n-dx/commit/7a6eeabfe2a97d511ebbc980f0e1155134e88d48), [`c4a1a61`](https://github.com/en-dash-consulting/n-dx/commit/c4a1a614884022d74c477dc3d792550f7e7735cc), [`844b636`](https://github.com/en-dash-consulting/n-dx/commit/844b63698f9ccda4f81b83362257b16dfcb065c2), [`e41d31f`](https://github.com/en-dash-consulting/n-dx/commit/e41d31fff91f9599ffc1e85d38cf1fad8da9e162), [`af89c92`](https://github.com/en-dash-consulting/n-dx/commit/af89c92e0b643d37b1380bd4eb4c383a32168c67), [`20c1d2b`](https://github.com/en-dash-consulting/n-dx/commit/20c1d2be598d61a4cb1b055d8abd28b8127618a8), [`c357d36`](https://github.com/en-dash-consulting/n-dx/commit/c357d364ff0609368c12f8a797e468960fed53f6), [`0766fc9`](https://github.com/en-dash-consulting/n-dx/commit/0766fc96d9e266814c57c5bb29d3ae1b41ad99e7), [`6f9db39`](https://github.com/en-dash-consulting/n-dx/commit/6f9db391476e7a2afff41389cb7f6d6dd85f6fa1)]:
  - @n-dx/rex@0.9.1
  - @n-dx/llm-client@0.9.1
  - @n-dx/sourcevision@0.9.1

## 0.9.0

### Minor Changes

- [#569](https://github.com/en-dash-consulting/n-dx/pull/569) [`5642744`](https://github.com/en-dash-consulting/n-dx/commit/5642744d20ed4509fc21b8a4828cb9c533b95290) Thanks [@endash-shal](https://github.com/endash-shal)! - Release 0.8.0 · Find your way — a minor release.
  
  The accumulated changesets are individually patches, by the repo's standing rule that a change defaults to `patch` unless a release says otherwise. This one says otherwise: 0.8.0 adds capability rather than only fixing behaviour, so the release is a minor and the fixed group moves together.
  
  What it adds:
  
  - **The hub** serves every registered repository from one per-user process on port 3117, with a project chooser and a reverse proxy at `/p/<id>/`, so several projects no longer contend for a port.
  - **Worktree-aware navigation** — a `/w/<key>/` slot in the URL, workspace-tagged WebSocket frames and a breadcrumb switcher, so a branch worktree's PRD, runs and analysis are addressable and writes stay scoped to the worktree the URL names.
  - **The Workspaces board**, with each worktree's PRD delta against the anchor and the ability to start a run in another worktree by name.
  - **`ndx mcp <server>`**, a shim that forwards a stdio MCP client to the hub with the workspace header, so a desktop session in a worktree reaches that worktree's servers.
  - **Hub admission** — a global session cap and memory headroom check that queues a run instead of answering 503.
  
  Changesets takes the highest bump across everything pending, so this is the only entry that needs to say `minor`.

### Patch Changes

- [#526](https://github.com/en-dash-consulting/n-dx/pull/526) [`ddd4e15`](https://github.com/en-dash-consulting/n-dx/commit/ddd4e1573f7a1e80c943ffa2875347b9f8b4717c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex add` (smart add) and the dashboard's proposal accept routes now keep `loe`, `loeRationale` and `loeConfidence` on the tasks they create; invalid values are dropped. `rex add` no longer strips the fields while attaching duplicate reasons.

- [#569](https://github.com/en-dash-consulting/n-dx/pull/569) [`c1af698`](https://github.com/en-dash-consulting/n-dx/commit/c1af6987f02b0620edea263c4415fa1219b03d4e) Thanks [@endash-shal](https://github.com/endash-shal)! - Close every known dependency vulnerability ahead of the release.
  
  `pnpm audit` reported two critical and three high advisories. One was reachable from shipped code: `@modelcontextprotocol/sdk` 1.30.0 (GHSA-6qxp-vccf-f47h, an OAuth client that could send credentials to an authorization server the MCP server chooses), a direct dependency of rex, sourcevision and web. It moves to 1.32.0.
  
  The other four are transitive and are pinned with overrides in the same style as the existing ones: `proxy-addr` ≥ 2.0.8 (GHSA-jqcg-44mw-7w3h, IP spoofing — reached from shipped code through the MCP SDK's express), plus three that only ever load in development tooling — `shell-quote` ≥ 1.11.0 (GHSA-pqg4-j6r4-53mv, via `@changesets/cli`) and `vue` ≥ 3.5.42 with `source-map-js` ≥ 1.2.2 (GHSA-g2v6-rqmx-r4w6 and GHSA-68fv-2mgg-jv7q, both via vitepress's docs build).
  
  `pnpm audit` now reports no known vulnerabilities.

- [#486](https://github.com/en-dash-consulting/n-dx/pull/486) [`153f6a2`](https://github.com/en-dash-consulting/n-dx/commit/153f6a2babfc936f39fd659a4a8e6686a826b5f8) Thanks [@endash-shal](https://github.com/endash-shal)! - Initialize a blank folder — including its git repository — from the dashboard.
  
  `ndx start` in an empty folder already served the setup page with an
  **Initialize project** button, but the init it ran could never create a git
  repository: the preflight prompt that offers one needs a TTY, and the wizard
  spawns `ndx init` with piped stdio. A folder set up that way stayed outside
  version control, with auto-commit, pair programming, and the hench run loop
  silently disabled.
  
  `ndx init` now takes `--git` / `--no-git`, which answer that prompt ahead of
  time — the only way a run without a TTY can create a repository. `--git` also
  gets the `chore: n-dx init` baseline commit the interactive path makes, so the
  working tree is clean straight out of init.
  
  The setup wizard asks the question in the browser instead. A new
  `GET /api/commands/init/preflight` reports whether the folder is already a
  repository and whether `git` is on PATH; the question appears only when there
  is something to decide, is disabled with an explanation when git is missing,
  and travels to `POST /api/commands/init` as `git: boolean`. The init status
  endpoint reports `gitRequested` / `gitInitialized`, confirmed from disk rather
  than from the exit code — `ndx init` treats a failed `git init` as a warning
  and still exits 0.
  
  The wizard also addresses the project through its hub prefix now. Plain `ndx
  start` registers with the per-user hub, which serves each project at
  `/p/<id>/`; the page's root-relative `fetch("/api/...")` calls reached the hub
  instead, which answers 409 once a second project is registered.
  
  Initializing from the dashboard also moves the running server onto the layout
  init wrote. A server started in an empty folder resolves its paths before
  anything exists, so it holds the legacy roots (`.rex`, `.sourcevision`,
  `.hench`) while `ndx init` gives a new project the `.ndx/` container — the
  dashboard went on serving the setup page, and every data route read an empty
  project, until the server was restarted by hand.

- [#588](https://github.com/en-dash-consulting/n-dx/pull/588) [`1dfc0c7`](https://github.com/en-dash-consulting/n-dx/commit/1dfc0c7e7947ffa6054cb6ef9efc214805253a16) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Each package's full build now ends by writing `dist/.build-stamp.json`, a hash of the source it compiled. The repository's affected test gate uses it to tell a current build from a stale one by content rather than by file times, so a partial build no longer hides stale compiled code and an identical-content rewrite no longer demands a rebuild.
   The stamp is excluded from the published tarballs.

- [#517](https://github.com/en-dash-consulting/n-dx/pull/517) [`fa447e5`](https://github.com/en-dash-consulting/n-dx/commit/fa447e5fb97e4ed0311d1f9c2826600fed183bf9) Thanks [@endash-shal](https://github.com/endash-shal)! - A completed task's commit now contains every file the run changed.
  
  Reported from the dashboard's run-task button: files the agent had changed
  were missing from the commit, and the task was recorded `completed` anyway.
  Two independent causes, both of which committed before the task was verified
  complete.
  
  **The commit only ever held what the agent staged.** The prompt asks the
  agent to `git add -- <path...>` naming each path and never to stage the whole
  tree, so any file it forgot was simply absent from the commit. A new
  `stageRunWork` stages the run's own work itself, and does it *before* the
  uncommitted-work gate inspects the tree — order being the point. The gate's
  job is to refuse a completion claim while finished work sits uncommitted, not
  to punish an incomplete `git add`; staging first means it sees the run's work
  as staged and the commit carries all of it, while anything that is **not**
  the run's work stays dirty and is still refused.
  
  Four exclusions keep that from meaning `git add -A`: anything already dirty
  when the run started (the operator's work in progress, captured by the new
  `captureBaselineDirty`), hench's own runtime artifacts including the
  `.hench-commit-msg.txt` sentinel, and the PRD paths, which
  `performCommitPromptIfNeeded` stages itself *after* writing the completion so
  the status transition and the code land together. With no baseline captured
  nothing is staged at all — an unknown baseline cannot tell the run's work from
  the operator's, and guessing is how someone's work-in-progress ends up inside
  a task commit.
  
  **The mid-run auto-commit timer is off by default** (`hench.commitMsgTimeoutMs`
  now defaults to `0`, was 300000). Armed, it fired five minutes after the agent
  wrote its commit message — during the rest of the session and the whole review
  pass — and committed whatever happened to be staged at that instant: before
  the test gate, before the uncommitted-work gate, before the completion was
  written, and without staging the PRD paths or the review repairs. It then set
  `didAutoCommit()`, which short-circuits the real commit path, so the
  completion write never reached a commit either and the next run's pre-run gate
  inherited it. The case it covered — a run that dies after the agent staged its
  work — is handled without committing anything unverified: the uncommitted-work
  gate refuses to record the task done, and the next run's pre-run commit gate
  offers the leftovers as a checkpoint. A positive value restores the timer.
  
  That key was also described in three places as "how long the commit-message
  generation call may run", which it never was. `ndx config`, `hench config` and
  the dashboard's config form now say what it does.
  
  No change was needed for per-iteration gating: `runIterations`, `runLoop` and
  `runEpicByEpic` already call `shouldStopForUncommittedWork` between tasks, and
  `between-task-uncommitted-guard.test.ts` already pins all three.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The notes file a dashboard run's context notes travel in no longer outlives a failed write, a failed spawn or a server shutdown, and a server start removes `ndx-context-*` directories left behind more than a day ago.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Copied `ndx work` commands are runnable: the Prepare task modal quotes the notes-file placeholder, and `ndx work --resolve` quotes paths with double quotes on Windows.

- [#516](https://github.com/en-dash-consulting/n-dx/pull/516) [`97a67c5`](https://github.com/en-dash-consulting/n-dx/commit/97a67c52da8c5ea7aa800dc91b58fe06424d13a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Add an untracked file to `.gitignore` from the dashboard's git status panel.
  
  The panel exists because hench's pre-run gate refuses to start an autonomous
  run against a dirty tree, and the usual reason it trips is untracked noise —
  build output, a scratch file, a local log — that should never have been in
  git's view at all. Until now the only ways out were committing the noise or
  discarding it; ignoring it meant leaving the browser.
  
  Untracked rows now carry an **Ignore** button that appends the path to the
  project's `.gitignore` via a new `POST /api/git/ignore`, and the list
  refreshes in place so the next one can go too.
  
  The route writes one anchored, literal entry per request (`/build/out.js`,
  not `out.js`), escaping any glob metacharacters in the path so a file named
  `report[1].txt` ignores that file rather than a character class. It creates
  `.gitignore` if absent, appends cleanly to one without a trailing newline,
  and skips an entry already present. Tracked and already-ignored paths are
  refused with an explanation rather than written: `.gitignore` has no effect
  on a path git already tracks, so writing the entry would look like it worked
  and do nothing.

- [#513](https://github.com/en-dash-consulting/n-dx/pull/513) [`252829f`](https://github.com/en-dash-consulting/n-dx/commit/252829f03d3075b4d849b9bbb37ee2d8452512e8) Thanks [@endash-shal](https://github.com/endash-shal)! - Start a loop or a fixed number of tasks from the dashboard, not just one.
  
  The dashboard's only run control started exactly one task. `hench run` has had
  `--iterations=<n>` and `--loop` since long before the dashboard existed, so the
  only way to leave an agent working through the queue was to abandon the
  dashboard and go to a terminal — on the very screen that shows what the queue
  contains.
  
  `POST /api/hench/execute` now accepts `mode`:
  
  - `single` — one task. The default, and what a request naming no mode has
    always produced, so existing clients are unaffected.
  - `iterations` — plus an `iterations` count, becomes `--iterations=<n>`.
  - `loop` — becomes `--loop`: task after task until nothing is actionable.
  
  `--task` still names where to start in every mode; hench autoselects by
  priority for each task after the first, so a loop begins exactly where the
  operator clicked. `--reset-deferred` is unaffected and still applied when the
  starting task is deferred.
  
  The count is bounded at 25. Not a CLI limit — `hench run` takes any number —
  but a limit on what one unattended click may commit to, since the spawned
  process outlives the tab that started it. Past that, `loop` is the honest
  choice: it stops when the queue is empty rather than when a number runs out.
  
  In the viewer, the mode picker sits at the three "start the next actionable
  task" entry points (the Rex Dashboard's Up Next card, the Hench Runs empty
  state, and the Live view). It is opt-in: the Workspaces board renders one
  button per worktree row, where the question is which worktree to start rather
  than how much work the click commits to.
  
  The picker qualifies **Start now**, the split button's one-click run, and the
  chosen mode is named on that menu item ("Start now · until done", "· 5 tasks").
  It deliberately does not touch the Prepare task modal the primary click opens:
  the modal configures one run of one task in detail and prints the command line
  for it, so a mode on its label would describe a run it does not start. The mode
  resets to a single task once a run starts — a picker that only changed hidden
  behaviour, or one that stayed on "until done", is how someone launches a
  queue-long run believing they started one task.
  
  One validator judges the mode everywhere it is read — the execute route, the
  `execute/check` the hub asks before queuing, and the hub proxy. A mode is
  validated in `judgeExecuteRequest`, the function both server routes share, so
  `execute/check` answers for it too; without that the hub could admit a request
  only the spawn would refuse. A present-but-unrecognised mode is an error rather
  than a fall back to `single`: the proxy used to keep only the modes it
  recognised and drop the rest, so a saturated hub queued `{ mode: "looop" }` as
  a single-task run and started it a minute later, where the direct route
  answered 400 — the same request judged two ways depending on how busy the
  machine was.
  
  The mode travels with the request through the hub's queue. A queued entry is
  replayed from what the hub stored, not from the original body, so a mode that
  stopped at the queue would start one task under a 202 that said "until done";
  `QueueEntry` therefore carries it alongside the run options, and the hub's 202
  echoes it — including through the duplicate-entry replacement, which rebuilds
  the entry field by field, so a re-ask that changed the mode drained with the
  old one. The flags themselves are emitted by `workCommandArgs`, the one
  builder the server spawns from and the modal prints from, rather than being
  appended at the spawn site. `RunMode` and the iteration bounds moved to
  `src/shared/run-options.ts` for the same reason: the server, the hub and the
  viewer all read them, and three copies are three things free to drift.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `POST /api/hench/execute` accepts `options` for one run: `model`, `provider`, `permissionMode`, `review`, `reviewModel`, `skipTestGate`, `maxTurns`, `tokenBudget`, `fresh`, `allowDirty` and `contextNotes`, each translated to its `ndx work` flag through an allow-list in `src/shared/run-options.ts`. The model must be in the active vendor's catalog and the provider one the vendor supports. `contextNotes` is written to a temp file, passed as `--context-file` and removed when the run ends. An unknown key or invalid value answers 400 naming the key, and the 202 echoes the accepted options. A run the hub queues keeps its options and replays them when admitted. Asking again for a queued task keeps its place and uses the newer options. Blocked tasks now answer 409 naming their blockers. An in-progress task can be started when no live run in any worktree and no claim holds it.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Two near-simultaneous `POST /api/hench/execute` requests for one task no longer both spawn a run: the task is reserved before the checks are awaited, and the second request answers 409 "already starting". A spawn that throws now answers 500 with the reason.

- [#518](https://github.com/en-dash-consulting/n-dx/pull/518) [`f11785e`](https://github.com/en-dash-consulting/n-dx/commit/f11785ec333e3eb456a2f0b9e512e35dd280e955) Thanks [@endash-shal](https://github.com/endash-shal)! - Offer `promptAgentToMarkInProgress` and `git.commitMessage` from `hench config`
  too.
  
  Both keys reached hench's schema, the dashboard's config view and `ndx config`'s
  help text, but never hench's own `CONFIG_FIELDS` — so the one surface an
  operator reaches from the terminal could neither show nor set them, and the
  cross-package contract test caught the three lists disagreeing.
  
  `promptAgentToMarkInProgress` now carries its default in the schema rather than
  only at the prompt-building use site, so a parsed config states the value the
  dashboard marks against. The `git.*` rows record no default: the group is absent
  from `DEFAULT_HENCH_CONFIG()`, so hench applies those at the use site and no
  value inside it survives a parse of the defaults.

- [#599](https://github.com/en-dash-consulting/n-dx/pull/599) [`168b80c`](https://github.com/en-dash-consulting/n-dx/commit/168b80c1edfe45f408cedb75d6ca0efc2cbc8e29) Thanks [@endash-shal](https://github.com/endash-shal)! - Report repo identity and scan counts on `GET /api/status`, and name the repository on each hub card.
  
  The sv section of the status response gains `repo` (the analysis manifest's repo identity), counts for `outbound` and `infrastructure`, and `readiness` — an explicit `null` until the SDLC readiness scorer exists, so the field is part of the contract now rather than a second response shape later. Every field is present on an unanalysed project, carrying null or zero instead of being absent.
  
  The hub's `ProjectCard` carries `repoName` and `remoteHost`, and the home page shows them under each card's title. A project's registered name is the worktree's; the repo name is the repository's, so two worktrees of one repository now read as what they are. The hub still makes no direct read of any `.sourcevision/` path — all of this arrives through the child's HTTP API.
  
  `RepoIdentity`, `InfrastructureData` and its members are exported from `@n-dx/sourcevision` and re-exported through web's `domain-gateway.ts`.

- [#486](https://github.com/en-dash-consulting/n-dx/pull/486) [`153f6a2`](https://github.com/en-dash-consulting/n-dx/commit/153f6a2babfc936f39fd659a4a8e6686a826b5f8) Thanks [@endash-shal](https://github.com/endash-shal)! - Start a new project from the hub.
  
  The hub's chooser listed the repositories `ndx start` had registered and gave
  no way to add one — a new project meant leaving the browser, making a folder,
  and running the CLI there. It now has a **New project** button: a folder name,
  the directory to put it in, and the exact absolute path it will create, checked
  against the filesystem as you type.
  
  That preview is the point. `GET /api/hub/new-project` resolves the path
  server-side and says whether it can be created, so `..`, a relative parent and
  a `~` all display as what they actually are, and the refusals arrive before
  anything is written: a parent that does not exist, a name that is really a path,
  a folder that already has content (pointed at `ndx start` instead). An existing
  *empty* folder is adopted, and says so.
  
  `POST /api/hub/projects/new` re-plans rather than trusting the client, creates
  the folder, registers it with the hub's own n-dx binary, and answers with its
  URL — the setup wizard an uninitialized project already serves, which is where
  assistants, the LLM vendor and the git repository get decided. One path into
  init, the one that already works. The button is busy, with a spinner and the
  path it is creating, for the seconds the folder and its server take.
  
  A hub-created folder also gets the `.n-dx-web.pid` / `.n-dx-web.port` markers
  `ndx start` would have left, so `ndx start status` and `ndx start stop` work in
  it like any other registered project.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The hub's queued 202 now echoes the accepted run options, as the project server's 202 does, and the viewer's `HubQueueEntry` carries `options`. `GET /api/hub/queue` no longer includes `contextNotes` text, scoped or not: entries keep their other options and gain `hasNotes: true`.

- [#586](https://github.com/en-dash-consulting/n-dx/pull/586) [`5756add`](https://github.com/en-dash-consulting/n-dx/commit/5756addaec3304e7450a0ba487e881a33dca1e92) Thanks [@ryrykeith](https://github.com/ryrykeith)! - With auth on, the hub now presents the per-user token on every call it makes to a project server. Its queued-run replay and `POST /api/hench/execute/check` pre-check used to get 401 (a queued run was dropped as "could not start", the pre-check failed open), and the in-flight count behind the machine-wide session cap read 0, so the cap never held. `ndx refresh --live-server`'s reload request sends the token too.

- [#529](https://github.com/en-dash-consulting/n-dx/pull/529) [`2028e7a`](https://github.com/en-dash-consulting/n-dx/commit/2028e7a2e298d88c9b9d66020cc380bbdce19b4c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Clear the last literal `.rex/`, `.hench/` and `.sourcevision/` paths, and make
  the policy that forbids them a wall rather than a ratchet.
  
  Where n-dx keeps its state is `resolveLayout`'s decision — `.ndx/rex` or
  `.rex`, depending on the project's layout. A literal takes that decision a
  second time in a file that has no idea which layout it is running under, and it
  fails *silently*: the wrong path is simply a path nothing wrote to, which is
  indistinguishable from a project that has nothing to show.
  
  Two of the sites cleared here were live defects of exactly that shape, both on
  a migrated project: `rex analyze` stamped every proposal it derived from an
  analysis with `.sourcevision/zones.json`, naming a file the project does not
  have, and hench's reviewer was told to list `.rex/prd_tree/` before capturing a
  finding — a listing that came back empty, so every finding looked new and
  duplicates got filed. A third, sourcevision's `prd-epic-resolver`, built its
  paths from a fixed `.rex` too, but in a helper nothing calls; it now asks the
  resolver so the literal is gone, and no command's behaviour changes.
  
  The rest were display copy and one bucket key. Viewer text that names a
  directory now names the command or the tool instead (`Make sure hench is
  initialized for this project`), because the browser has no resolver to ask;
  `sv pr-markdown --help` names its output file without fixing the folder; and
  `rex status`'s canonical PRD bucket key now comes from the same constant as the
  attributions it has to match, rather than from a second copy that agreed by eye.
  
  Two files are allowed to keep a literal, both with the argument in their own
  docstring: the viewer's `state-paths.ts`, a browser-safe twin of
  `layoutStateNames()` pinned to the resolver by the contract test, because
  `layout.ts` reaches for `node:fs` at module scope and cannot be bundled; and
  rex's `LEGACY_SOURCE_FILE_PREFIX`, which is a value already written into PRD
  data rather than a path any process constructs.
  
  `tests/e2e/layout-literal-policy.test.js` now fails on *any* `.rex/`, `.hench/`
  or `.sourcevision/` literal outside that allow-list, naming the file and line.
  The `.n-dx*` config files stay on the inventory ratchet — 29 sites across
  llm-client, hench and web are still waiting on that sweep — and the detector's
  self-test now floors the files it visits rather than the literals it finds, so
  it keeps its teeth once the debt reaches zero.

- [#529](https://github.com/en-dash-consulting/n-dx/pull/529) [`f46b952`](https://github.com/en-dash-consulting/n-dx/commit/f46b95235daf551cd0cc7c13ae162204aff74527) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Route core, and the rest of hench and web, through the layout resolver
  
  Every remaining literal `.rex/`, `.hench/`, `.sourcevision/` and `.n-dx*` path
  in the orchestration tier now asks `resolveLayout` where the project keeps its
  state, as do the hench and web files the 0.8.0 sweep left behind. On a project
  that has run `ndx migrate-layout`, these all used to read or write a path
  nothing is there — silently, because a missing file is indistinguishable from
  an empty project. Fixed as part of that:
  
  - `ndx start stop` and `ndx start status` could not find a running dashboard on
    the new layout, and left it running.
  - The staleness notice told a migrated project that all three of its tool
    directories were missing and that it should re-run `ndx init`.
  - `ndx ci`, `ndx export` and `ndx refresh` looked for analysis output, the PRD
    tree and run records under the legacy names; the cross-vendor reviewer found
    no codebase context, no PRD excerpt and no configured test command.
  - The guard baseline every hench run is clamped to blocked `.rex/**` and
    `.hench/**` only, so on the new layout the agent was free to write n-dx's own
    state, PRD tree included.
  - The "Strict Safety" workflow template had drifted from that baseline in both
    copies, dropping half its credential patterns — choosing it left a project
    *less* protected than the default. Both copies now derive from the baseline.
  - Hench classified PRD writes by file extension on the new layout, so run
    summaries reported bookkeeping as documentation changes.
  - The note printed after a completion commit named a gitignore path the
    operator does not have, so following it left the tree dirty and the next run
    still refused to start.
  
  New in `@n-dx/llm-client`: `layoutStateNames()`, for the classifiers that are
  handed a path and must recognise n-dx state under either layout rather than
  resolve one.

- [#541](https://github.com/en-dash-consulting/n-dx/pull/541) [`1560be5`](https://github.com/en-dash-consulting/n-dx/commit/1560be5ad66314385a5daadbf8a3e9b0fad06d32) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the Product page, Changes view and capability page for the v2 product and change layers, rendered from fixtures.
  
  The Product page lists areas and capabilities with their computed status and health, draws each open change as an overlay on the capability it will amend, and marks the rows where the spec has moved ahead of the build (revised) or what was built is broken (defective). The Changes view groups work by planned release and then by stage, with the unscheduled backlog last. The capability page shows a capability's statement, its criteria including inherited ones, the history of changes that moved it, and where it lives in code.
  
  The three views are driven entirely by props and ship with v2 fixtures. No routes are wired and no existing view changes, so they can be built ahead of the v2 reader.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live idle card and the Workspaces cards now use the shared start offer: an in-progress next task with no live run shows Resume, a blocked one names its blockers, and one with a live run links to its Live page. `/api/live` next tasks now carry `status` and `blockedBy`.

- [#582](https://github.com/en-dash-consulting/n-dx/pull/582) [`8bae238`](https://github.com/en-dash-consulting/n-dx/commit/8bae2381270ebcd2c419b4c8d8c90ffd87ac3047) Thanks [@endash-shal](https://github.com/endash-shal)! - Every remaining reader of the project config asks the layout resolver where it lives, so a project on the `.ndx/` layout is read from `.ndx/config.json` (and `.ndx/config.local.json`) instead of a root `.n-dx.json` nothing writes. In `@n-dx/llm-client` that is `loadLLMConfig`, `loadClaudeConfig`, `loadProjectOverrides` and `loadProjectOverrideSources`, whose `file` label is now the root-relative path of the file read; `PROJECT_CONFIG_FILE` and `LOCAL_CONFIG_FILE` keep their legacy names for labels. In `@n-dx/hench`: the project CLI name, the Claude weekly budget, archival and retention settings and `hench.fullTestCommand`. In `@n-dx/web`: the config, LLM, features, CLI-timeout, project-settings, SourceVision (zone pins and Ask timeout), token-usage and usage-cleanup routes, the CLI name, and the dashboard usage ledger, which lands at `.ndx/web-usage.jsonl` on that layout; `GET /api/cli/timeouts` now reports `configFile`, the file the overrides live in, and the CLI Timeouts page shows it. The layout-literal inventory reaches zero.
  
  The same sweep found that hench and rex recovered the project root from their own state directory as its parent, which on the `.ndx/` layout is the container — so `loadConfig`'s project overrides and the `loadClaudeConfig` / `loadLLMConfig` adapters read `.ndx/.n-dx.json`, a file nothing writes, and every override was silently ignored on a migrated project. `projectRootOf` in `@n-dx/llm-client` (exported, and through hench's llm gateway) steps over the container, and `loadProjectOverrideSources` and both packages' adapters use it.

- [#512](https://github.com/en-dash-consulting/n-dx/pull/512) [`b770844`](https://github.com/en-dash-consulting/n-dx/commit/b770844d0100ca48eedc07d7aacfcf149c2583ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop refusing every task completion in a project on the `.ndx/` layout.
  
  Hench's uncommitted-work gate refuses to mark a task completed while the work
  that completes it is still in the working tree. The PRD writes hench makes
  itself are supposed to be discounted — the agent's `rex_update_status` call and
  hench's own completion write land in the PRD tree by design, so counting them
  would refuse everything.
  
  That discount list, and the staging list the completion commit derives from the
  same definition, were spelled `.rex/...` and nothing else. On a project migrated
  to the `.ndx/` container the PRD lives at `.ndx/rex/prd_tree/`, so:
  
  - `prdPathsToStage` existence-checked a directory nothing writes to, found none,
    and the completion commit landed empty;
  - the gate then refused the task over the very PRD writes it had just declined
    to stage, naming `.ndx/rex/prd_tree/<task>/index.md` back to the operator as
    the agent's leaked work.
  
  Every task completion failed, in every project on the new layout, with a
  refusal that pointed at hench's own files. Both lists now come from the layout
  resolver: the staged set resolves the project's actual layout (a writer has to
  pick one spelling), while the discount covers both, like
  `HENCH_RUNTIME_GITIGNORE_ENTRIES` already did for `.hench/` — it is a classifier
  answering "is this hench's own bookkeeping?" about a path git handed it.
  
  Two adjacent paths had the same literal and are fixed with it:
  `scopePrdPathsToReport` dropped every path in the store's save report, and the
  changed-files/repaired-files filters treated nothing under `.ndx/` as
  bookkeeping — so on a migrated project every run looked like it had changed
  files and the full-suite gate fired for runs that produced no code.
  
  Separately, the dashboard's derived `<rexDir>/.cache/prd.json` is now gitignored
  by `rex init` and discounted by the gate. The `ndx start` watcher regenerates it
  on every PRD write, so a run made while the dashboard was up had a regenerable
  cache file counted as the task's own leaked work — on either layout. Its name is
  now a single constant in rex's paths module (`PRD_CACHE_DIRNAME`) that the
  gitignore rule, the gate and the web server all read, rather than a literal in
  each.

- [#571](https://github.com/en-dash-consulting/n-dx/pull/571) [`fccbbf3`](https://github.com/en-dash-consulting/n-dx/commit/fccbbf3366e7b4e04be7db7d744c2d026e7f783d) Thanks [@endash-shal](https://github.com/endash-shal)! - `--no-review` and `--no-skip-test-gate` turn a saved setting off for one run.
  
  Once a task can save `review: true` or `skipTestGate: true`, a one-off run needs a way to overrule it. Both new flags resolve as `cli-flag`, so they outrank the task's saved block and `hench.*` alike, and — being flags — they apply to every task in a `--loop` or `--iterations` run. `--no-review` carries the saved `reviewModel` and `reviewOptional` with it: there is no reviewer left for them to configure.
  
  A flag and its negation together is an error rather than a guess (`--review` with `--no-review`, `--skip-test-gate` with `--no-skip-test-gate`), as are `--review-model` or `--review-optional` alongside `--no-review`.
  
  **Behaviour change for dashboard clients.** The run-option tables now carry a `negatedFlag` for the two booleans a task can save, so `runOptionArgs` turns an explicit `review: false` / `skipTestGate: false` into `--no-review` / `--no-skip-test-gate` instead of emitting nothing. That is what lets the dashboard say "off for this run even though the task saved it on". An **absent** key still emits nothing, which is how a request leaves the decision to the task and the config, and booleans nothing can save (`fresh`, `allowDirty`, `reviewOptional`) are unchanged — their `false` still says nothing.

- [#596](https://github.com/en-dash-consulting/n-dx/pull/596) [`48eaa38`](https://github.com/en-dash-consulting/n-dx/commit/48eaa386916bdcaf8b208924716906793f903008) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `outbound.json`: the shape, the file, and the pipeline wiring.
  
  SourceVision detects only the provider side of HTTP — `server-route-detection.ts` and `go-route-detection.ts` record the routes a repository serves. Without the consumer side, a repository that calls another repository is invisible, which is what makes a cross-repo scan impossible.
  
  This lands the first slice: `OutboundDependency` in `schema/v1.ts`, a zod schema in `schema/validate.ts`, `outbound.json` registered in `schema/data-files.ts` and web's mirror, and `analyzers/outbound-detection.ts` wired into `sv analyze`. Call-site detection is deliberately empty — JS/TS HTTP and gRPC, JS/TS queue/database/cache, and Go each follow as their own change, and each now adds detections to a file consumers already read rather than introducing the file and its readers at once.
  
  What the detector does find today is declared contracts: OpenAPI/Swagger documents and `.proto` files, with their paths. These are not found through the inventory alone, because `.proto` and `.yaml` are not programming languages and the default `codeOnly` inventory omits them — both sources are consulted and merged, rather than widening the inventory and changing the input to zone detection for every project.
  
  `confidence` grades the call, not the target: a direct client call is `certain` whether its target is a URL literal or an environment variable name, and only indirection in reaching the call lowers it. `targetSource` separately says where the call points, so the cross-repo matcher has a category to switch on rather than a threshold to guess at. The three-level vocabulary it uses was `SdlcConfidence`, named for having had exactly one user; now that a second, unrelated record grades its detections with it, it is `Confidence` — still one definition, so the two cannot drift.
  
  Deterministic throughout: no LLM, no network, and canonically ordered, so re-analysing an unchanged tree produces a byte-identical file.

- [#530](https://github.com/en-dash-consulting/n-dx/pull/530) [`7e7ef56`](https://github.com/en-dash-consulting/n-dx/commit/7e7ef56662296000ad88f0a2d0bcf718e5a984ba) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Every package's guidance now lives in its `AGENTS.md`, with the `CLAUDE.md`
  beside it reduced to the `@AGENTS.md` import. Zone policies and seam registries
  for `core`, `rex`, `hench` and `web` were readable only by Claude Code before
  this; Codex and any other assistant that reads nested `AGENTS.md` files now get
  them too. `tests/e2e/instruction-alignment.test.js` fails a package CLAUDE.md
  with no AGENTS.md beside it, or one carrying content of its own.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A deferred task can be started from the Prepare task modal again. The prep resolve and brief preview now pass `--reset-deferred` for a deferred task, as execute already did, so the modal no longer reports it as not actionable or disables Execute. `ndx work --task=<id> --dry-run --reset-deferred` now builds the brief as if the reset had happened, treating the tasks it would reset as pending, and still writes nothing.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A website open in the user's browser can no longer make the dashboard spawn `ndx` through the prepare routes.
  
  `GET /api/hench/prep/:taskId` and `GET /api/hench/ready` answer 403 to a foreign `Origin` or a `Sec-Fetch-Site` other than `same-origin`/`none`; header-less CLI requests still work. Prep and preview spawns are capped at 4 in flight (429 beyond), identical prep resolves share one spawn, and a client disconnect kills the child. `exec` gains a `signal` option to support this.

- [#578](https://github.com/en-dash-consulting/n-dx/pull/578) [`2873f95`](https://github.com/en-dash-consulting/n-dx/commit/2873f9529f5a72f43202b010515f9a81a4a4d079) Thanks [@endash-shal](https://github.com/endash-shal)! - `PUT /api/hench/prep/:taskId` saves a task's own run settings.
  
  **Server capability only.** This adds the endpoint and the state behind it; the Prepare task modal does not call it yet, so there is no new button in the dashboard. Saving from the UI arrives with the modal work that follows. A client that drives the API directly — or the rex MCP tools and `rex update --run`, which already wrote this block — can use it today.
  
  The block is the one `ndx work` has read since PR 3. Body is `{run, version}`; `null` or `{}` clears it, and the write happens inside `store.withTransaction` against the workspace the request addressed, so it takes that worktree's PRD lock and rewrites that worktree's tree alone.
  
  **Concurrency.** `version` is a short fingerprint of the saved block, canonical at every depth (a nested per-vendor model map is part of the identity, so changing one pin changes the version) — `"none"` for a task carrying nothing — reported by `GET /api/hench/prep/:taskId` as `savedVersion` and checked inside the transaction. A save made against a stale read answers 409 carrying the current block and version, so the client can show what it would overwrite and offer to do it (resending with that version is the overwrite). The fingerprint is deliberately not the item's `lastModified`: renaming a task would otherwise invalidate a run-settings version the renamer never touched, and every open modal would report a conflict that is not one. Two blocks differing only in key order share a version.
  
  **Refusals.** A launch-time key (`fresh`, `allowDirty`, `resetDeferred`) is a 400 naming it — those are chosen per launch and saving one would decide for a run nobody has started. Unknown keys, wrong types and out-of-range values go through rex's own `validateRunSettings`, so what the dashboard accepts cannot drift from what the store and `ndx work` accept. A model or provider the active vendor cannot serve is refused before it is saved; a pin for a *different* vendor is allowed through, because a saved block is vendor-agnostic by design. Containers cannot carry run settings (400), a missing task is 404, a workspace with no PRD is 404, and a foreign-site PUT is refused before anything is written.
  
  `GET /api/hench/ready` rows gain `saved: boolean`, so the list can mark a task that will not run on the project defaults.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Escape in the Prepare task modal now closes only the modal, not the PRD detail panel underneath, so focus returns to the Start control.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Keep an open Prepare task modal on the task it was opened for. When the host's next task changed while the modal was open (the Up Next and Live idle cards poll), the modal kept the first task's edits and preview but posted the new task's id on Execute. The Start button now captures the task at open, and the modal is keyed by task id.

- [#581](https://github.com/en-dash-consulting/n-dx/pull/581) [`3e4795b`](https://github.com/en-dash-consulting/n-dx/commit/3e4795b8fa35b2629c38d1bb46b0b3cc26851a44) Thanks [@endash-shal](https://github.com/endash-shal)! - Save run settings on a task from the Prepare task modal.
  
  The modal could only ever change a run; now it can change the task. **Save** writes the settings onto the PRD item through `PUT /api/hench/prep/:taskId`, where `ndx work` reads them from a terminal too, while **Execute** still carries the edits and nothing else. Two buttons on purpose: "run it differently once" and "this is how this task should be run" are different intentions, and conflating them would make every experiment permanent.
  
  - **Sources.** A field the task supplies reads "saved on task" with the project default beside it ("project default: claude-sonnet from llm.claude.model"), rather than naming a config key that is not where the value came from.
  - **What Save writes.** The fields that differ from the project default, never a launch-time one (`fresh`, `allowDirty`). A field equal to the project default is omitted rather than frozen, so a later config change still reaches the task. An untouched model keeps its saved tier and per-vendor pins as they were; a chosen model is written as a pin for today's vendor, with other vendors' pins carried through untouched. Saved notes for the agent are shown and kept until the reader empties the field, and a chosen reviewer is saved whenever a review would run, including one the config turns on.
  - **Reset to defaults** clears the edits first; with nothing but saved settings left it asks ("Clear 2 saved settings for this task?") before clearing the block.
  - **Conflicts.** A save that lost a race shows "These settings were saved elsewhere since you opened this." with Reload (take the server's, drop the edits) and Overwrite (resend the same write, a clear included, against the version the refusal named).
  - **Off the anchor** the footer says "Saved on branch <name>; lands when the branch merges".
  - **Footer** counts the two facts separately: what applies to this run, and what is saved and applies from the terminal too. **Ready to run** marks a task carrying saved settings with a labelled dot.
  
  **Behaviour change.** The adversarial review and full-test-gate controls are no longer locked when the config turns them on. They were disabled because nothing could turn them off for a single run; `--no-review` and `--no-skip-test-gate` now can, so switching one off sends the negation flag and the run honours it.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the Prepare task modal at `/work/prep/<taskId>`: every per-run `ndx work` option with its value and where it came from, per-run overrides marked with a reset, a preflight list that keeps Execute off while a refusal stands, the equivalent command line (built with the same argv builder the server spawns), a brief preview, and Execute with started, queued, refused and migratable outcomes. The prep response now also carries `dir` and the item's `detail` (priority, parent chain, criteria count).

- [#531](https://github.com/en-dash-consulting/n-dx/pull/531) [`3cb924b`](https://github.com/en-dash-consulting/n-dx/commit/3cb924b648eb3076ac738b65caaff15a6f186c59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The shipped `ndx start --preview` mockups no longer advertise the removed tracker integrations. Gone: the "ndx sync" settings page and its "Remote Sync" panel from `index.layout.json`, and the `s-sync` page, the `sync` command row and the `rex.notionSync` / `rex.integrations` flag rows from `option1-demo.html`. `build.js` copies `src/preview` into `dist/preview`, so these were published in the package and offered commands and flags that no longer exist. The `/notion-config` → `/project` redirect alias is unchanged — it is kept for 0.8.0 URL compatibility.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Prepare task: a brief preview that returns after Back no longer reopens itself, and focus follows the form/preview toggle.

- [#607](https://github.com/en-dash-consulting/n-dx/pull/607) [`3aa765d`](https://github.com/en-dash-consulting/n-dx/commit/3aa765d8c079e99d20ed7210d2aaee1c26530755) Thanks [@endash-shal](https://github.com/endash-shal)! - The Product view now renders "all product nodes" for a constraint that applies to everything, matching decision N1 and the v2 schema. The viewer's "map node" and "Map layer" comments follow the same vocabulary, so the UI, the schema and the rule messages no longer use two names for one concept.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Start now and Ready to run now show a queued run's live position and say "Could not start: <reason>" when the hub drops it at replay, instead of a one-shot "Queued — position N". The Prepare task modal's notice is shared with both.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A queued dashboard run its project server would refuse is now refused when it is asked for, not queued: the hub asks the new `POST /api/hench/execute/check` before answering 202 and returns the server's 4xx instead. A queued run refused when its turn comes is kept in `GET /api/hub/queue` as `dropped` with the server's status and message, and the Prepare task modal shows "Could not start: …" and offers Execute again. Per-run models from the live catalog still validate after its 10-minute cache expires.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `GET /api/hench/ready` reads `limit` as a whole number: `1e9` returns the maximum of 50 rows instead of one, and `10abc`, `2.5` or an empty value use the default of 10. Zero and negative values still clamp to 1.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `GET /api/hench/ready` now orders tasks as `ndx work --auto` picks them: a task with `maxFailedAttempts` consecutive hard failures in `.hench/runs` is left out, and its dependents are offered as if it were done.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `GET /api/hench/ready` orders its rows with one selection pass instead of one next-task search per row. On a 1,800-item PRD the request took about 5 s on the server's event loop and now takes a fraction of a second.

- [#531](https://github.com/en-dash-consulting/n-dx/pull/531) [`3c8a8c1`](https://github.com/en-dash-consulting/n-dx/commit/3c8a8c17703fe347c353d578aa39ec25fa5ac539) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Remove the dashboard's Notion and integration surfaces
  
  The tracker adapters went in the previous change; these are the dashboard
  surfaces that existed to configure them. With no adapter behind them they
  were a settings page for a feature that could not do anything.
  
  Deleted: `routes-notion.ts` and its `/api/notion/*` endpoints, the
  `notion-config` and `integration-config` views, the Notion schema wizard and
  both stylesheets. The `rex.notionSync` and `rex.integrations` feature toggles
  go with them — from the registry in `routes-features.ts`, from the route gate
  table, from the static export's prerendered `features.json`, and from
  `ndx config --help`. The Project page is now two sections, analyze-and-plan
  settings and feature flags, with no conditional sections at all.
  
  `routes-notion.ts` held the last dynamic `@n-dx/rex/dist/*` import in web, so
  that escape hatch and its entry in the architecture policy's documented-dynamic-
  imports registry are both gone. Note that this leaves rex's
  `src/store/adapter-config.ts` — extracted in the previous change specifically so
  this route could keep reading `.rex/adapters.json` — without a consumer. It is
  still exported from `public.ts` and still tested; removing it is a rex decision
  rather than a dashboard one, so it is left for the follow-up that records the
  tracker removal.
  
  Two things were removed beyond the literal surface, both because deleting the
  routes made them dead rather than merely unused:
  
  - `RouteFeatureGate.prefix`. Both subtree gates were Notion's and
    `/api/integrations`'; every remaining gate lists its paths exactly. An
    unexercised matching branch in the function that decides whether a disabled
    feature's endpoint is reachable is the kind of thing that rots, so the field
    and its branch go and `exact` becomes required.
  - The `.cmd-sync-*` and `.intg-*` rules in `commands.css` and `deployed.css`,
    orphaned when the sync buttons and the integration list went.
  
  The `/notion-config` and `/integrations` redirect aliases are deliberately
  kept. They are URL compatibility for 0.8.0 bookmarks and they point at
  `/project`, which still exists — removing them would turn a working redirect
  into a 404 and buy nothing.
  
  Unrelated robustness fix in `tests/e2e/prompt-census.test.js`: it enumerated
  files with `git ls-files`, which reads the index, then read each one from disk.
  A file deleted in the working tree but not yet staged made it throw ENOENT and
  report as a crash rather than as the clean result it was. It now skips paths
  that no longer exist.

- [#531](https://github.com/en-dash-consulting/n-dx/pull/531) [`f65e407`](https://github.com/en-dash-consulting/n-dx/commit/f65e407f4a4cec417865be9c40c3b58cf9040f99) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Remove the Notion, Jira, Asana and GitHub Projects store adapters, `rex sync`,
  `rex adapter` and the `sync_with_remote` MCP tool.
  
  No project used them. They were written against the whole-document store model
  that the folder tree replaced, so every one of them had been carrying a
  conversion layer between a PRD tree and a flat list of remote records — four
  copies of a translation nobody was running. A work-tracker bridge is planned as
  its own package, built against the storage model that actually exists; keeping
  four unexercised adapters alive until then buys nothing and has to be migrated
  with every schema change.
  
  Gone from rex: `notion-*`, `jira-*`, `asana-*` and `github-projects-*` under
  `src/store/`, the `integration-schema` system and its four tracker schemas, the
  `AdapterRegistry`, `SyncEngine`, the `sync` and `adapter` CLI commands with
  their help entries, and the `sync_with_remote` MCP tool. Gone from core: the
  `ndx sync` command, its help and its command-effects entry.
  
  Two dashboard surfaces went with them, because they could not outlive what they
  called: `routes-integrations.ts`, whose every handler began by importing the
  deleted integration-schema modules, and `POST /api/commands/sync`, which spawned
  the deleted CLI command. `routes-notion.ts` survived this step — it reads and writes
  `.rex/adapters.json` through the credential helpers below — and is removed by the
  dashboard change that follows. The Notion wizard, the feature toggles and the
  remaining viewer views are a separate change.
  
  What stayed, and why:
  
  - **`file-adapter.ts` and `folder-tree-store.ts`** — the local stores. Untouched.
  - **`src/core/sync.ts`** — not the sync engine despite the name. It is the item
    bookkeeping module (`stampModified`, `isModifiedSinceSync`,
    `ITEM_BOOKKEEPING_FIELDS`), and the folder-tree store, the bundle exporter and
    `rex analyze` all depend on it.
  - **Credential redaction and environment resolution**, moved at this step into
    `src/store/adapter-config.ts` as plain functions rather than registry methods,
    so that `routes-notion.ts` kept working. They did not survive the release:
    deleting that route left them without a caller, and a later change in this
    same release removes the module. See the entry for that change.
  - **`WorkItemLink` in the schema.** Items may still record a link to an external
    system; nothing in rex writes one now. Removing the field is a schema change,
    not an adapter removal.
  
  `createStore` keeps its adapter-name parameter and now throws for anything other
  than `"file"`. Callers across rex and hench pass the name explicitly, and a
  parameter that is silently ignored is worse than one that is checked — a caller
  asking for `"notion"` should hear that it is gone rather than quietly receive the
  local store.
  
  The redaction rule changed shape. It used to read each adapter's `configSchema`
  for an explicit `sensitive: true`; those schemas went with the adapters, so the
  key name is now the only signal and the rule had to widen to match it. A key
  whose name ends in `token`, `secret`, `password`, `passphrase`, `apikey` or
  `credential` is redacted — which newly covers `apiToken`, previously caught only
  by Jira's schema flag. The match is anchored at the end of the key rather than
  done as a substring, so `projectKey` is still stored in the clear: redacting it
  would write a `__redacted` marker over a value that was never a secret and then
  fail to resolve it from an environment variable nobody set.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The repository trust banner's error text uses the `--red` theme token instead of the retired `--danger`.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx work --resolve` applies repository trust like a run: on an untrusted repository it reports `bypassPermissions` lowered to `acceptEdits` (source `repository-trust`) with a non-blocking `untrusted-repository` warning, and the Prepare task modal's preflight shows it.

- [#571](https://github.com/en-dash-consulting/n-dx/pull/571) [`755fa10`](https://github.com/en-dash-consulting/n-dx/commit/755fa101c96eed3bf5638b4023055c4a96722276) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx work --resolve` reports the task's saved block and each saved setting's fallback.
  
  Three additions to the JSON report, for the dashboard's Prepare task modal:
  
  - **`saved`** — the task's `run` block as rex validated it, or `null` when it carries none. A block that fails validation is also `null`, with a `saved-settings-ignored` warning saying so; it is never a refusal.
  - **`fallback`** — on every setting a saved value won, `{value, source}`: what the setting would resolve to without the saved block. Computed by calling the same resolver with the task left out, so the "project default" shown beside a saved value is the one a run would really fall back to.
  - **`warnings`** — now also carries the saved-setting notes (`saved-model-incompatible`, `saved-provider-unavailable`, `saved-provider-overridden`, `saved-review-unsupported`, `saved-permission-mode-dropped`) instead of writing them only to stderr. A run started from a browser has no stderr anyone reads, and "your saved model cannot run on this vendor" is exactly what the reader needs before clicking Execute.
  
  The printed `command` is unchanged and now pinned by a test: it is built from flags alone, so a task's saved settings never appear in it. Copying the command and running it applies them again by themselves, where writing them in would freeze them against a block that can change. A flag that happens to equal a saved value is still printed — it was typed.
  
  Web gains the types only, no UI: `PrepResponse.saved`, `PrepResolved.fallback`, and `saved` in the prep test fixture.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx work --resolve` reports `reviewOptional` and its printed command keeps `--mine`, `--priority` and `--context-file`; the dashboard run-options allow-list accepts `reviewOptional`.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx work --resolve` always reports the reviewer model, its source and the vendor's built-in reviewer (`vendorDefault`), with or without `--review`. The Prepare task modal shows that reviewer when review is switched on, and its "Vendor default" choice sends the built-in model explicitly.

- [#537](https://github.com/en-dash-consulting/n-dx/pull/537) [`0845cde`](https://github.com/en-dash-consulting/n-dx/commit/0845cde144ff5365a24d0df7cbd48752870e9492) Thanks [@ryrykeith](https://github.com/ryrykeith)! - PRD items can carry a `run` block of saved run settings (a portable model `tier`, optional per-vendor `models` pins, provider, permission mode, review, `reviewTier`, `reviewModels`, review optional, skip test gate, max turns, token budget, context notes). Saved settings are vendor-agnostic, so a task saved under Claude still carries its model intent when run on Codex; there is no bare `model` key. An unknown vendor name in `models` is rejected with the valid list. It round-trips through the folder tree, an empty block is never written, and rex exports `validateRunSettings` so every writer applies the same rules. Writers (MCP, `rex update --run`) reject a malformed block; the store keeps a hand-edited or newer-version block unchanged, warns on load, and never lets it block writes to other items. Nothing reads the block yet.

- [#537](https://github.com/en-dash-consulting/n-dx/pull/537) [`26a7883`](https://github.com/en-dash-consulting/n-dx/commit/26a7883836aae2d1a1bbea9f827d6675f9ee08bb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The saved `run` block is writable through MCP `add_item` / `edit_item` (`edit_item` replaces the whole block, `run: null` removes it) and `rex update --run='<json>'` (`--run=` or `--run=null` clears it); invalid JSON or an unknown key exits non-zero listing the valid keys, and an unknown vendor in `models` is rejected naming the valid vendors. `PATCH /api/rex/items/:id` now accepts only status, failureReason, priority, tags, title, description, acceptanceCriteria and requirements (any other key is a 400 naming it) and does its read-modify-write inside the PRD lock, answering 409 when another process holds it.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tests only: the Prepare task workspace-header test covers prep, preview, execute and migrate; run-option checks are pinned for control characters, prototype keys, string-typed numbers and integer bounds; the run-options contract test reads source and checks bounds against `ndx work --resolve`; the resolve no-side-effect test seeds a session cache; a real-server test sends `/w/<key>/` and `X-Ndx-Workspace` to the ready and prep routes.

- [#546](https://github.com/en-dash-consulting/n-dx/pull/546) [`c88ffad`](https://github.com/en-dash-consulting/n-dx/commit/c88ffadeb92f385691f72cfb1356f77910da3d18) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Cut the test time of an `ndx work` run ([#539](https://github.com/en-dash-consulting/n-dx/issues/539)).
  
  - **Gate-only retry.** When a task's last run failed only at the test gate, with its work committed and its completion held, `ndx work --task=<id>` skips the agent, re-runs the gate and applies the held completion on green. A review that passed on the same commit is inherited. A second gate failure goes back to the agent. The read-only refusal also stands down when earlier attempts already committed the task's files, instead of re-spawning the agent cold.
  - **Flake absorption.** With `hench.testGate.rerunCommand`, an unattended run re-runs only the failed suites once; a pass counts and is recorded as `testGate.flakyRerun`.
  - **Scoped gate.** `hench.testGate.command` replaces the gate command and takes `{base}`, the run's start commit. `scripts/run-all-tests.mjs` gains suite labels, `affected <base>` and `--list`. Run records gain `testGate.base`, `suites`, `scopeFallback`, `firstAttempt`, `rerun` and `gateOnlyRetry`. Both keys are opt-in and appear in `ndx config` help and the dashboard config fields.
  - **Scoped checks.** The agent brief and the in-hench reviewer run scoped checks only, since the gate follows and CI runs everything.
  - **Interactive gate prompt.** A failed gate on an interactive run offers rerun/abort/skip again; it used to abort silently.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's Self-Heal panel now starts `ndx self-heal` with `--auto`. The spawned process has no TTY, so it used to refuse without `selfHeal.autoConfirm`. `--auto` also skips self-heal's own confirmation prompt. The panel's "I understand — proceed" step replaces that prompt: it must be clicked before the Run button appears, and nothing is sent to `POST /api/commands/self-heal` until then. The panel's copy now says the run is unattended.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Every Start button opens the Prepare task modal; the PRD panel's separate Execute path is gone.
  
  `StartTaskButton` is now a split button. The primary click opens the Prepare task
  modal (a Workspaces card passes its key through, so the modal sends
  `X-Ndx-Workspace`); the menu keeps "Start now", the old one-click run with no
  options. When the hub queues the run (202), Start now shows the queue position
  and reason instead of reporting a start.
  
  The PRD task panel's `ExecuteTaskButton` and its private execute, progress and
  Stop code are removed. The panel shows the same split button, or a link to
  `/live/task/:taskId` while a run is live (Stop lives in Live). Offering rules are
  shared by every surface (`startOffer`): pending and deferred tasks start,
  in-progress tasks with no live run show Resume, and blocked tasks list what they
  wait on instead of a button. This also fixes the panel's Rules-of-Hooks violation
  and gives it the migrate-slugs recovery the other surfaces had.

- [#592](https://github.com/en-dash-consulting/n-dx/pull/592) [`cc9ce2c`](https://github.com/en-dash-consulting/n-dx/commit/cc9ce2c7b3df83ac6709bfaf38240ea23bff564b) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface SDLC readiness through the CLI, `ndx`, MCP and the dashboard status.
  
  `analyze` now writes `readiness.json` beside `sdlc-profile.json` — the weighted
  score computed from the detected profile. Four surfaces read it:
  
  - `sourcevision readiness [--json]` prints the scorecard, with the evidence
    behind each dimension and the gap that would raise it.
  - `ndx readiness` delegates to it, forwarding `--json`.
  - `get_readiness` on the SourceVision MCP server returns the same artifact.
  - `GET /api/status` carries `sv.readiness` (`{ overall, analyzedAt }`), null
    rather than absent on an analysis that produced no readiness artifact.
  
  The CLI and MCP surfaces recompute from `sdlc-profile.json` rather than serving
  `readiness.json`, so a weight change shows up without a re-analysis; the
  persisted file is for readers that only want the headline. The scorecard is
  heuristic — it detects whether a practice exists and is wired up, not whether it
  is good — and is labelled as such on every surface that publishes it.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the reads behind the Prepare task modal and the Ready to run list. `GET /api/hench/prep/:taskId` runs `ndx work --task=<id> --resolve` in the request's workspace and returns hench's resolved settings, sources and refusals plus the resolved vendor's model catalog, the hub's admission state (running, max, queued, available memory, pressure, memory-paused), the worktree's branch, anchor, dirty and live-run state, and `recommendation: null`; a failed or timed-out resolve answers 502 with the stderr tail. `POST /api/hench/prep/:taskId/preview` validates `{options}` against the run-option allow-list (400 naming the key) and returns the `--dry-run` brief. `GET /api/hench/ready?limit=N` lists the next tasks in `ndx work --auto` order, skipping tasks another worktree holds, and marks in-progress tasks with no live run as `resume`. The hub proxy now states its admission header, with the memory fields, on prep reads as well as `GET /api/live`.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Task blockers, start notices and error toasts use the theme's `--text-dim` and `--red` tokens instead of undefined `--text-secondary` and `--danger`, so they meet AA contrast in both themes. A test now rejects those names and checks fallback-guarded tokens in the Prepare task stylesheet.

- [#607](https://github.com/en-dash-consulting/n-dx/pull/607) [`ce25794`](https://github.com/en-dash-consulting/n-dx/commit/ce2579434098c1994c73d91b1964f2b54b8f202f) Thanks [@endash-shal](https://github.com/endash-shal)! - One host-neutral git-remote-URL parser, in `@n-dx/llm-client`
  
  `parseGitRemoteUrl` splits an origin remote into `{ host, owner, repo, path, kind }`
  for https, ssh and scp-style forms, where `kind` distinguishes `github`,
  `bitbucket-cloud`, a self-hosted `bitbucket-dc` and `other`. Data Center's `/scm/`
  clone prefix is dropped from the identity path, so the same repository parses the
  same way over https and ssh.
  
  The three readers that each had their own regex now share it: sourcevision's
  analysis manifest and iso export, and the web dashboard's project route. They
  disagreed — web's split on `[/:]` read `ssh://git@host:7999/PROJ/repo.git` as the
  repo `repo` with no owner, while sourcevision's could not parse that form at all.
  A new architecture-policy rule fails the build on a second parser.
  
  An scp-style remote does not need a dotted host: `git@work-github:acme/widget.git`
  (an ssh config alias) and `git@bitbucket:PROJ/widget.git` (a short internal
  hostname) parse like any other. Only a one-character host is refused, because
  that is a Windows drive letter and git reads `C:\src\repo` as a local path.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Bound `tokenBudget` at `Number.MAX_SAFE_INTEGER` and require every integer run option to serialize as plain decimal digits. `{"options":{"tokenBudget":1e21}}` used to become `--token-budget=1e+21`, which hench's `parseInt` read as 1, so the run hit its budget at once while the 202 echoed 1e21. It now answers 400 naming `tokenBudget`, and the Prepare task modal's number input carries the same `max`.

- [#541](https://github.com/en-dash-consulting/n-dx/pull/541) [`6acceef`](https://github.com/en-dash-consulting/n-dx/commit/6acceef81a1d5a470dd37875245018103264d7de) Thanks [@endash-shal](https://github.com/endash-shal)! - The Changes view now treats a blank or whitespace-only `plannedRelease` as unscheduled instead of rendering it under a nameless release heading, and trims surrounding whitespace when bucketing, so `2.1.0` and ` 2.1.0 ` group as one release.

- [#549](https://github.com/en-dash-consulting/n-dx/pull/549) [`3a6c2f6`](https://github.com/en-dash-consulting/n-dx/commit/3a6c2f678454d53664add2e2986878050bad0345) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Test-only: the worktree run-watcher test no longer races macOS FSEvents startup. It rewrites the run file on each retry, spaced above the watcher's debounce, so a write made before the watcher is live is not missed.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's memory status and the hub's admission floor now use the shared available-memory reading from `@n-dx/llm-client` instead of `os.freemem()`. On macOS that counts the inactive, speculative and purgeable pages the OS hands back on demand, so a healthy 16 GB Mac that read 115 MB free (dashboard "critical" at 99% used, and below the hub's 2 GB floor, which queued every dashboard-started run) now reads the ~3.9 GB it can actually give out and starts the run. Linux and Windows are unchanged — `os.freemem()` is already the available figure there.
  
  `GET /api/hench/memory` keeps its fields and adds `system.availableBytes`, `system.pressure` and `system.source`; `system.freeBytes` carries the available reading. A machine whose memory cannot be read at all reports health `"unknown"` with `freeBytes`, `usedBytes` and `usedPercent` null, the memory panel shows a dash and "Memory reading unavailable" with no warning styling, and the hub admits rather than queuing — nothing flags, throttles or holds a run on a reading that does not exist. The hub's queue snapshot gains `availableBytes` and `pressure`, and the panel and queue copy now say "available" rather than "free".
  
  The Live tab's machine strip shares the same reading: `GET /api/live`'s `machine.memory` gains `availableBytes`, `pressure` and `source` alongside its existing fields, with `belowFloor` computed against an explicit null check (`null <= floor` is `true` in JavaScript, which used to flag an unreadable machine as below the floor). The tile itself — labelled "Memory" — now shows the pressure level (Normal / Warn / Critical / Unknown) as its value and `<available> available · floor <floor>` as detail, and is outlined only for warn/critical pressure or a known reading at or below the floor — never for an unknown one, which was the bug: a healthy 16 GB Mac with ~3.9 GB reclaimable showed "Free memory 144 MB" outlined in orange against the hub's 2 GB floor.

- [#550](https://github.com/en-dash-consulting/n-dx/pull/550) [`262b555`](https://github.com/en-dash-consulting/n-dx/commit/262b55551c883f0fbfbce28ff23c0acc6e479acf) Thanks [@endash-shal](https://github.com/endash-shal)! - Correct the web data-file mirror and pin it to sourcevision's.
  
  `packages/web/src/shared/data-files.ts` restates sourcevision's `DATA_FILES` — it has to, because web reaches sourcevision only through `server/domain-gateway.ts` and the viewer is bundled for the browser. It had drifted two entries behind, so `classifications.json` and `project-profile.json` were never mtime-watched and the dashboard did not live-reload when they changed, and both were missing from `GET /data`. The viewer genuinely reads classifications, so that one was a live defect.
  
  The two lists are now asserted equal in `cross-package-contracts.test.js`, which previously only checked that `DATA_FILES` was exported, not that the copies agreed. Adding a data file now fails the build unless both files are edited in the same change.

- [#547](https://github.com/en-dash-consulting/n-dx/pull/547) [`52bad34`](https://github.com/en-dash-consulting/n-dx/commit/52bad34c49badd68347133ebc02b8eda35efccc1) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On Windows, a recorded run pid that is not a multiple of 4 is now reported dead instead of probing a neighbouring process, so abandoned runs read as orphaned rather than live.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Show a Ready to run list at the top of the Work page: the next ten tasks `ndx work --auto` would pick, each with Prepare… (Resume… for an in-progress task with no live run) and a menu to Start now or copy the terminal command. The Epic-by-Epic panel is no longer rendered; its server route stays until the Run queue panel replaces it.

- [#503](https://github.com/en-dash-consulting/n-dx/pull/503) [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Starting a run from a Workspaces card now opens Live in that card's workspace (`/w/<key>/live/task/<id>`, with the hub prefix kept) instead of the viewer's own, for both a started and a queued run. A card for the viewer's own workspace still opens Live in-app.

- [#597](https://github.com/en-dash-consulting/n-dx/pull/597) [`5941241`](https://github.com/en-dash-consulting/n-dx/commit/594124123ada89c08571274f80b425e84d17b2dc) Thanks [@endash-shal](https://github.com/endash-shal)! - Derive cross-repo workspace crossings from outbound HTTP calls and shared infrastructure, not only npm imports.
  
  `analyzers/workspace-crossings.ts` had one signal: an external import naming a sibling member's package. It now has three, all in that same module — no second aggregator. Every cross-repo crossing carries `source: "npm" | "http" | "infra"` and an `evidence` sentence naming both sides, because an edge no import supports is unreadable without one. Intra-repo crossings carry neither; they come from the import graph Louvain partitioned, which is none of these three.
  
  **http** reads each member's `outbound.json` and resolves its `http` and `grpc` calls against the other members. A literal target is matched on two independent signals: the host being a member's declared `baseUrl` host (a person said so), and the path being a route that member's `components.json` says it serves (its own analysis said so). Both hold, or a declared host with no path to check, is `certain`; either alone is `likely`. The edge lands on the file that handles the route, not the package entry point.
  
  **infra** joins two members that reference one resource: the same `infra:` id is `certain`, the same name for a queue, topic, bucket or stream is `likely`. The rule is restricted to those kinds deliberately — two repos both having a `database` called `primary` are not talking to each other. A shared resource has no direction, so one edge is emitted per member pair per resource, oriented by member id so repeated runs produce the same graph.
  
  Two questions this settles:
  
  - **Matching an env-var name to a producer.** Neither side's convention is taken as canonical. Both the variable name and the host are reduced to their identity words — the ones that say *which* thing rather than *what* it is — so `ORDERS_URL` and `orders.internal` meet in the middle without either repo adopting the other's spelling. `WorkspaceMember` gains `baseUrl` for members to declare where they serve; an env match against a declared base URL is `likely` and is drawn, an env match against a member's *name* alone is not.
  - **The threshold.** `certain` and `likely` are drawn, `inferred` is withheld — every `inferred` rule here rests on two names resembling each other and nothing else, and a name collision between repositories is ordinary. A wrong edge in a cross-repo map is read as architecture, which is worse than a missing one.
  
  Withheld candidates are reported rather than dropped: `sourcevision workspace` prints each one with its reason, which is nearly always a member that has declared no `baseUrl` — a one-line fix the operator cannot make if the near-miss is invisible. `sourcevision workspace --status` prints edge counts broken down by source.
  
  `sortCrossings` now tie-breaks on `source`, because two sources can draw the same file pair and without it `zones.json` stopped being byte-stable. Web mirrors the two new fields in its schema and zone-crossing validator; a zod object strips undeclared keys, so leaving them out would have made the evidence vanish between the analyzer and the dashboard rather than fail loudly.
- Updated dependencies [[`ddd4e15`](https://github.com/en-dash-consulting/n-dx/commit/ddd4e1573f7a1e80c943ffa2875347b9f8b4717c), [`572d759`](https://github.com/en-dash-consulting/n-dx/commit/572d759e36c98f7f067e40fb1474f7154792a081), [`8eb093b`](https://github.com/en-dash-consulting/n-dx/commit/8eb093be6652abaeb840e585332eb33b2bf740b0), [`536e9a8`](https://github.com/en-dash-consulting/n-dx/commit/536e9a88647bbb57fe6379fd1b36d8b52e755467), [`c47baa4`](https://github.com/en-dash-consulting/n-dx/commit/c47baa4a12f8428b755bfbf8008a89b2a5e4e589), [`28f38ab`](https://github.com/en-dash-consulting/n-dx/commit/28f38ab5a520f76ca551c30e544f796521d9cc60), [`f3694e7`](https://github.com/en-dash-consulting/n-dx/commit/f3694e7cab6d135f3e5bb791c01aa58232dab634), [`c1af698`](https://github.com/en-dash-consulting/n-dx/commit/c1af6987f02b0620edea263c4415fa1219b03d4e), [`d1ae043`](https://github.com/en-dash-consulting/n-dx/commit/d1ae043b127dcf49085e408a0c287d50b6cf2a10), [`1dfc0c7`](https://github.com/en-dash-consulting/n-dx/commit/1dfc0c7e7947ffa6054cb6ef9efc214805253a16), [`5399355`](https://github.com/en-dash-consulting/n-dx/commit/53993552706a40311b3caeef53f66be1944b40c0), [`73bab95`](https://github.com/en-dash-consulting/n-dx/commit/73bab9592b9ceda77239ad83b84b610c7db34f8e), [`d059e28`](https://github.com/en-dash-consulting/n-dx/commit/d059e284f7c9320e436884d96e3cc3467bc502b0), [`0df9e0f`](https://github.com/en-dash-consulting/n-dx/commit/0df9e0fcbb4cd85938301380f4a5a5968a470d5d), [`b73b061`](https://github.com/en-dash-consulting/n-dx/commit/b73b06162cb210705583e6846f2349de8901c85d), [`168b80c`](https://github.com/en-dash-consulting/n-dx/commit/168b80c1edfe45f408cedb75d6ca0efc2cbc8e29), [`e1393f0`](https://github.com/en-dash-consulting/n-dx/commit/e1393f02ee074010e9678873ba2ff1f39181a0ec), [`eff0f79`](https://github.com/en-dash-consulting/n-dx/commit/eff0f79db748ee2ec71c27abbde166fdcfbfc722), [`cf19d5a`](https://github.com/en-dash-consulting/n-dx/commit/cf19d5a29ffa9ad4df8bb2befb2dd3f266785e05), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b), [`b2b021a`](https://github.com/en-dash-consulting/n-dx/commit/b2b021a4394a868057f8f83e7bdc848c19c9144c), [`2028e7a`](https://github.com/en-dash-consulting/n-dx/commit/2028e7a2e298d88c9b9d66020cc380bbdce19b4c), [`f46b952`](https://github.com/en-dash-consulting/n-dx/commit/f46b95235daf551cd0cc7c13ae162204aff74527), [`b03c3a7`](https://github.com/en-dash-consulting/n-dx/commit/b03c3a74508c601c2e71596d6fc565a70cc3feb6), [`e6941fc`](https://github.com/en-dash-consulting/n-dx/commit/e6941fc042beeb45fb9ef91c102b2639f5ce4a43), [`3cb924b`](https://github.com/en-dash-consulting/n-dx/commit/3cb924b648eb3076ac738b65caaff15a6f186c59), [`8bae238`](https://github.com/en-dash-consulting/n-dx/commit/8bae2381270ebcd2c419b4c8d8c90ffd87ac3047), [`b770844`](https://github.com/en-dash-consulting/n-dx/commit/b770844d0100ca48eedc07d7aacfcf149c2583ec), [`31c0647`](https://github.com/en-dash-consulting/n-dx/commit/31c0647830a5b33d965e661acc41911d84ec5673), [`1a39dd5`](https://github.com/en-dash-consulting/n-dx/commit/1a39dd59ebf8ad3338e28e7ce111c6f3c52bbd25), [`9c16798`](https://github.com/en-dash-consulting/n-dx/commit/9c167986b258634de6a91abe3221c477fab5d2b4), [`48eaa38`](https://github.com/en-dash-consulting/n-dx/commit/48eaa386916bdcaf8b208924716906793f903008), [`7e7ef56`](https://github.com/en-dash-consulting/n-dx/commit/7e7ef56662296000ad88f0a2d0bcf718e5a984ba), [`4910d78`](https://github.com/en-dash-consulting/n-dx/commit/4910d7843de364099da985ccbb1fb43ed733d516), [`e18a6f3`](https://github.com/en-dash-consulting/n-dx/commit/e18a6f3cb6663afb72d6eb0d32a6405e6694a8bf), [`cc560f2`](https://github.com/en-dash-consulting/n-dx/commit/cc560f2ab365814ee414a7be905414fbc2642e50), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b), [`86751c5`](https://github.com/en-dash-consulting/n-dx/commit/86751c571f74bb04949e8b5cc1007eddf4ea1e21), [`fefc307`](https://github.com/en-dash-consulting/n-dx/commit/fefc3072a4a1f7a902a5f456fa4475faeebb5b71), [`3700d62`](https://github.com/en-dash-consulting/n-dx/commit/3700d62dc7a521353c813d5bab0776eef097bf07), [`f65e407`](https://github.com/en-dash-consulting/n-dx/commit/f65e407f4a4cec417865be9c40c3b58cf9040f99), [`d52dcd2`](https://github.com/en-dash-consulting/n-dx/commit/d52dcd20be39bb165bdfcb7d6f391bd7c07fd874), [`7009820`](https://github.com/en-dash-consulting/n-dx/commit/7009820fc4f80df48c03940161756ea7454c2260), [`5802bc2`](https://github.com/en-dash-consulting/n-dx/commit/5802bc221ecab89d6be697b65e90d6db8c138674), [`ac9592e`](https://github.com/en-dash-consulting/n-dx/commit/ac9592eeb6bc361aed36ae106ceaa28d4d710b2d), [`b6c2324`](https://github.com/en-dash-consulting/n-dx/commit/b6c2324e6d597cecdb2b19523f0b2410561f4249), [`81a283a`](https://github.com/en-dash-consulting/n-dx/commit/81a283afe4f66520417fdf06b5008c985ec5c1a1), [`c3d5eb0`](https://github.com/en-dash-consulting/n-dx/commit/c3d5eb070761ab8054c6a78f444db4833c203914), [`cc10e8f`](https://github.com/en-dash-consulting/n-dx/commit/cc10e8f9de93dd0733358d4c57b7ff4c92737eca), [`0ec098a`](https://github.com/en-dash-consulting/n-dx/commit/0ec098ae8fe51a8f62a7a8e8400eba9e47971a1d), [`0845cde`](https://github.com/en-dash-consulting/n-dx/commit/0845cde144ff5365a24d0df7cbd48752870e9492), [`26a7883`](https://github.com/en-dash-consulting/n-dx/commit/26a7883836aae2d1a1bbea9f827d6675f9ee08bb), [`f042e50`](https://github.com/en-dash-consulting/n-dx/commit/f042e5007066f8f61062e92ef5abe267df945177), [`d254b19`](https://github.com/en-dash-consulting/n-dx/commit/d254b19f7074d487f59f052063fa0ca918079bd8), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b), [`878ff2f`](https://github.com/en-dash-consulting/n-dx/commit/878ff2facb3cacb20f6727d0eca07d5a3e20f765), [`2543aa7`](https://github.com/en-dash-consulting/n-dx/commit/2543aa77b70af8133a28d8317cde4be32eb81739), [`0ec098a`](https://github.com/en-dash-consulting/n-dx/commit/0ec098ae8fe51a8f62a7a8e8400eba9e47971a1d), [`e188d87`](https://github.com/en-dash-consulting/n-dx/commit/e188d87cf3204ffa7f40bf5597ec78707a0564a0), [`cc9ce2c`](https://github.com/en-dash-consulting/n-dx/commit/cc9ce2c7b3df83ac6709bfaf38240ea23bff564b), [`ce25794`](https://github.com/en-dash-consulting/n-dx/commit/ce2579434098c1994c73d91b1964f2b54b8f202f), [`33eb557`](https://github.com/en-dash-consulting/n-dx/commit/33eb557571c1c3d0020a08e0d12318c34729600a), [`43bfdc2`](https://github.com/en-dash-consulting/n-dx/commit/43bfdc2a54c741ce489f8773addad39fd6e91ebd), [`8f74ce5`](https://github.com/en-dash-consulting/n-dx/commit/8f74ce575d927ce8f2b945631b48e299512d8006), [`aec78fd`](https://github.com/en-dash-consulting/n-dx/commit/aec78fdbf418c367c13fc5ea27583ce8bfba39d5), [`966f42b`](https://github.com/en-dash-consulting/n-dx/commit/966f42bb67c4ed3427ffec328afcbd1c3520268a), [`b24dea0`](https://github.com/en-dash-consulting/n-dx/commit/b24dea028c2d8b623a9c87a25df5f5fd7a309476), [`e0085f3`](https://github.com/en-dash-consulting/n-dx/commit/e0085f37d3b81e6b25b2bc6416687c29e63a7115), [`8f4385a`](https://github.com/en-dash-consulting/n-dx/commit/8f4385ab8e82bdc66b6e3a44bdd8bb64e0fb7af7), [`ff18c5f`](https://github.com/en-dash-consulting/n-dx/commit/ff18c5f8c6edca19f7a8c4032f60b77bb7317afa), [`7f24f8a`](https://github.com/en-dash-consulting/n-dx/commit/7f24f8abfe6790df3a19bc00408f94782a44afcf), [`441efa9`](https://github.com/en-dash-consulting/n-dx/commit/441efa9b87a779d0b433688a72a3bde18a9ab753), [`4670500`](https://github.com/en-dash-consulting/n-dx/commit/46705002256ecb6445d01f297c69ab0d59beafb9), [`ab06a3c`](https://github.com/en-dash-consulting/n-dx/commit/ab06a3c767ad4a1904f738341852da3cfedf48b5), [`0eb2303`](https://github.com/en-dash-consulting/n-dx/commit/0eb2303255ac0d8d32a7050201859f4bbd3e4014), [`a7f4f2c`](https://github.com/en-dash-consulting/n-dx/commit/a7f4f2c86bc0048de1068b89fa4f31d5bc147305), [`22f46cd`](https://github.com/en-dash-consulting/n-dx/commit/22f46cd853c558acbee7603e6358808913c7de09), [`ff842c5`](https://github.com/en-dash-consulting/n-dx/commit/ff842c57c3095f49ed305a19709f7c071c6b5f55), [`0196dec`](https://github.com/en-dash-consulting/n-dx/commit/0196decec982928a3528e52d8165d6318cef818c), [`034fecb`](https://github.com/en-dash-consulting/n-dx/commit/034fecbb0c5bb282bf50c9c24724272b67130891), [`454b148`](https://github.com/en-dash-consulting/n-dx/commit/454b148804a7b0505674748a9b8f7d26b025b000), [`aef2f1f`](https://github.com/en-dash-consulting/n-dx/commit/aef2f1f454bfad3c2da1eef844ce83d680937245), [`dd1e933`](https://github.com/en-dash-consulting/n-dx/commit/dd1e933604ef70fe18e1eb1361a4fee93dbbc936), [`b671123`](https://github.com/en-dash-consulting/n-dx/commit/b6711238559f132c7f0f7099b525d08108cfc445), [`6187c2a`](https://github.com/en-dash-consulting/n-dx/commit/6187c2ad176f8c74d66dcdbc306ece63c3d08935), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b), [`5941241`](https://github.com/en-dash-consulting/n-dx/commit/594124123ada89c08571274f80b425e84d17b2dc)]:
  - @n-dx/rex@0.9.0
  - @n-dx/sourcevision@0.9.0
  - @n-dx/llm-client@0.9.0

## 0.8.0

### Minor Changes

- [#459](https://github.com/en-dash-consulting/n-dx/pull/459) [`0e3623e`](https://github.com/en-dash-consulting/n-dx/commit/0e3623edbc25e417982a93db53aa7ae6b70fae2f) Thanks [@endash-shal](https://github.com/endash-shal)! - 0.8.0 — Find your way
  
  A single `.ndx/` directory for project state, with `ndx migrate-layout` to move
  an existing project onto it. A reorganised dashboard: views are stages, Analysis
  opens on the codebase map, settings are three pages (Robot Wrangler, Workflow,
  Project) on a shared save frame, and every moved path redirects. A Live tab for
  watching every run across a repository's worktrees. A per-user token on the hub
  and dashboard, and repository trust gating what a checkout's execution config
  may widen. New Claude model defaults, per-vendor agent models, per-field
  resolution of the legacy `claude.*` keys, and effects declared for every command
  and shown in a preflight banner.
  
  Every other changeset in this release is a `patch`, which is the repo default
  and correct for each change on its own. This one makes the aggregate a minor, as
  the 0.8.0 epic requires.

### Patch Changes

- [#502](https://github.com/en-dash-consulting/n-dx/pull/502) [`21e086d`](https://github.com/en-dash-consulting/n-dx/commit/21e086d6bade2453e179578ab3c5a102a1f445b6) Thanks [@dnaniel](https://github.com/dnaniel)! - The Analysis page now opens on the isometric codebase map. It sits under a one-line bar with the analysis branch, commit, age and the Re-analyze controls, and is followed by a row of stat tiles (files, zones, circular deps, average cohesion and coupling, signals) and a Next Steps panel that collapses to one summary line. Expand takes the map full screen, and Terrain starts collapsed since the page already leads with the map.
  
  `renderIsoMap` gains an `embed` option, requested by the dashboard with `GET /api/iso-map?embed=1`: the document fills its frame without scrolling, keeps only the level crumbs and camera tools as floating controls, drops the footer, and opens the details panel only for a selection. A plain scroll wheel is left to the host page, so scrolling past the map scrolls the page; Ctrl/⌘ + scroll or a pinch zooms, and the host can turn plain-wheel zoom on (full screen) and set the colour scheme over `postMessage`. New-tab and download links, `sv iso` and the `/iso-map` skill still produce the standalone page.
  
  Legend filters on the map now match nested zones: an area stays lit when any zone or sub-zone inside it has an active kind, the matching tiles on its face take the kind's colour, and each legend entry shows how many zones of that kind exist at every depth.
  
  The Plan page opens on a one-row Smart Add bar (description, Generate, and a "More" toggle for batch import, project scan and recent activity) instead of the full form, and the Work dashboard's duplicate Smart Add card is gone. The Plan page's Tasks section reads title → progress → one toolbar row (search, status and tag filters, item actions) → tree, with the hierarchy explainer moved to an ⓘ beside the title. Stage page headers are one compact line, and both pages fit any viewport: the top navigation scrolls inside its bar on phones, the side stage links give way there, and tooltips stay on screen.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A running `sv analyze` now publishes structured progress to `.sourcevision/.cache/analyze-progress.json`: mode, current phase and every phase's start and end, the enrichment pass, its batch k of n, judgment-cache hits and misses, and LLM calls, tokens and time per task class so far. The file is marked complete or failed when the run ends, and a file whose process has died reads as `interrupted`, never `running`. `GET /api/commands/sv-analyze/status` gains a `progress` field with that report and the previous same-mode run's per-phase timings, for terminal- and dashboard-started runs alike, and the server pushes an `sv:analyze-progress` WebSocket frame within about a second of each change.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A running analysis now refreshes its progress file every 15 s, and a `running` file not refreshed for two minutes reads as interrupted even when its pid is alive and its command line cannot be read (Windows, no `ps`). Stop on /live/analyze refuses such a file on every platform.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A stale analyze progress file whose pid the OS has given to another program no longer shows as a running analysis, and Stop on /live/analyze refuses to signal a process whose command line is not an analyze, saying why.

- [#456](https://github.com/en-dash-consulting/n-dx/pull/456) [`bc2cce2`](https://github.com/en-dash-consulting/n-dx/commit/bc2cce2abe82ba2b406f31731fa28bbdaa822dcb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard: one name per view, read by every navigation surface.
  
  View labels lived in four tables that had drifted apart — the breadcrumb, the
  guide, the stage sections, and a SourceVision tab list nothing rendered. The
  import map was "Map" in the breadcrumb and "Repository map" on the Analysis
  page, and both the agent run list and the PRD execution log were called
  "History". A new `viewer/views/view-meta.ts` gives every view one label, glyph,
  product and blurb; `stages.ts` re-exports it and now records only *where* each
  view sits. The top nav, stage pages, Home cards, breadcrumb, `document.title`,
  guide headings and settings overlay all read it.
  
  Labels that changed: the run list is **Runs** and the PRD log is **Execution
  Log** (both were "History"); the import map is **Repository Map** everywhere;
  Rex's "Analyze & Import" is **Add Items**; "Rex Dashboard" is **Up Next**; and
  the Workspaces board is **Workspaces** in the breadcrumb rather than "Overview",
  which previously collided with SourceVision's Overview. No route changed.
  Browser tab titles for pages no single package owns (Home, Token Usage,
  Workspaces, settings) name only the page, e.g. `Home | my-project | n-dx`.
  
  Navigation controls also keep an accessible name at narrow widths, where the
  shell hides some of their text.
  
  Fixes a crash on the Home page: `/api/status` is parsed with an unchecked cast,
  so a 200 whose body was missing a section threw during render and left the
  default landing page blank. A missing section now costs that card its numbers,
  the way an unavailable status already did.

- [#458](https://github.com/en-dash-consulting/n-dx/pull/458) [`0c2ccca`](https://github.com/en-dash-consulting/n-dx/commit/0c2ccca2b1ed9906c9abc89cdef54eb54f5253f5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard: add the shared settings frame (explicit Save, dirty indicator, leave guard).
  
  `viewer/components/settings-frame.ts` is the frame the three consolidated
  settings pages (Robot Wrangler, Workflow, Project) will render inside. It is
  controlled: a page hands it `dirty`, `saving`, `error` and `onSave` (plus an
  optional `onDiscard`), and the frame renders the page's fields, an explicit
  Save button disabled while clean or saving, and an unsaved-changes indicator.
  
  A new `viewer/hooks/use-leave-guard.ts` blocks every way of leaving a dirty
  frame — switching overlay entries, closing the overlay (✕/Escape), any
  `navigateTo`/`handleSidebarNav` call, and browser back/forward — behind an
  in-app "Keep editing / Discard changes" prompt, and arms `beforeunload` only
  while dirty. Back/forward can't be cancelled, so a blocked pop re-pushes the
  settings URL and only applies the popped navigation on Discard.
  
  No existing settings view adopts the frame yet — that lands with the three
  page tasks.

- [#471](https://github.com/en-dash-consulting/n-dx/pull/471) [`d339e94`](https://github.com/en-dash-consulting/n-dx/commit/d339e94af0d2e1be02c66305bf5e473633d53e6d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard breadcrumb links back to the hub and switches between registered projects.
  
  Behind the hub, the breadcrumb now starts with a "Hub" link to `/hub`. With two or more projects registered, the project name opens a keyboard-operable menu of every project with a status dot, the current one marked; choosing one opens the same view under `/p/<id>/`. The list is re-read each time the menu opens. With one project the name stays plain text, and without a hub (standalone `web serve`, a static export) there is no Hub link. Whether a hub is present is asked of `GET /api/hub/projects` rather than inferred from the URL, since a single registered project is served at the root alias.

- [#505](https://github.com/en-dash-consulting/n-dx/pull/505) [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add Claude Opus 5.5, Sonnet 5.5 and Fable 5.1, and move the Claude defaults onto them
  
  **The defaults have changed.** The standard tier (and the default when no model is
  configured) is now `claude-sonnet-5-5`. The heavy tier and the review model are now
  `claude-opus-5-5`. The `opus` alias now resolves to `claude-opus-5-5` and `fable`
  to `claude-fable-5-1`. `ndx init` offers Sonnet 5.5 (recommended), Opus 5.5,
  Fable 5.1 and Haiku 4.5.
  
  All three new models have a 1M context window and list pricing, so budget
  preflight, `ndx usage` and the dashboard spend views price them as known. That
  includes dated `-YYYYMMDD` snapshots. Previously they fell back to estimated
  rates and showed `known: false`.
  
  `claude-sonnet-5`, `claude-opus-5` and `claude-fable-5` are still priced and
  resolvable, and `ndx init` accepts them without an unknown-model warning.
  
  The dashboard config footer now shows every version part: `sonnet 5.5`,
  `fable 5.1`, `haiku 4.5`. Before, it showed `sonnet 5` and `haiku 4`.
  
  **Pinning back.** Older Claude Code releases can reject the new model ids on
  CLI-provider runs. If yours does, upgrade Claude Code, or pin the previous model:
  `ndx config llm.claude.model claude-sonnet-5 .`. For the heavy tier and review,
  also set `llm.tiers.claude.heavy` and `llm.claude.reviewModel` to
  `claude-opus-5`.

- [#505](https://github.com/en-dash-consulting/n-dx/pull/505) [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Claude API requests now send `llm.effort` as `output_config.effort`, and Claude Opus 5.5 defaults to `high` effort. `llm.effort` was parsed but never sent. With no matching rule, `claude-opus-5-5` gets `high` so the move from Opus 5 keeps its reasoning depth (Opus 5.5's API default is `medium`), and other models are unchanged. Effort is never sent to a model that rejects it (Haiku 4.5, Sonnet 4.5 and older) or when the value is not `low`, `medium`, `high`, `xhigh` or `max`; both cases print a warning. Claude Code CLI runs are unchanged.

- [#508](https://github.com/en-dash-consulting/n-dx/pull/508) [`f91ae26`](https://github.com/en-dash-consulting/n-dx/commit/f91ae2627c35e322a064965e3a396b13cb0416c2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Every `ndx` command now declares its effects — what it reads and writes, which phases call a model and roughly how often, what network it touches, and how long it takes. `ndx help --effects --format=json` prints the declarations, `GET /api/commands/manifest` attaches each one to its command unchanged (with the project's `layoutPaths` for expanding path tokens like `{rex}/prd_tree/`), and `docs/cli-ui-gap.md` gains a generated Command effects table (`node scripts/build-cli-ui-gap.mjs`).
  
  The preflight banner no longer promises "no model calls" for `ndx analyze --no-llm` or `ndx plan --fast`, neither of which turns the model off; each command now names the flags that actually do. The banner and run summary also name the right paths on a `.ndx/`-layout project.

- [#489](https://github.com/en-dash-consulting/n-dx/pull/489) [`05a8115`](https://github.com/en-dash-consulting/n-dx/commit/05a811560a19baf95e69bc19a8c906dad2b3fea9) Thanks [@endash-shal](https://github.com/endash-shal)! - Require a per-user token on the hub, dashboard and preview servers when started with `--token-file`. The token is created in the file if absent (mode 0600) and every request and WebSocket handshake must present it as `Authorization: Bearer`, `X-Ndx-Token`, or the `ndx_token` cookie; a safe-method navigation carrying `?ndx_token=` sets the cookie and redirects to the clean URL. The hub passes the file to the project servers it spawns and sends the token on its own probes, and the proxy forwards the browser's cookie. A server started without `--token-file` behaves as before.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard layout: the sidebar is replaced by the layout prototyped in the preview demo.
  
  - **Top bar:** the logo and project name (which take you home) and three stage tabs — Analysis, Plan, Work — plus search.
  - **Landing page** at `/home`, now the default: the three stages as columns side by side, each with its product mark, a line on what it is for, and its headline numbers from `/api/status`.
  - **Stage pages** at `/analyze`, `/plan`, `/work`: each composes the existing views as collapsible sections, mounted only while open, with an "Open" link to the view's own page. The import map's 2D and isometric 3D views share one section behind a toggle. PRD progress and the execution log sit on Work; CLI help sits above run history on Plan.
  - **Side stage links** on every staged page step around the loop, Analysis → Plan → Work → Analysis.
  - **Bottom bar:** server identity, a settings cog, per-stage status badges, a System · Light · Dark theme control (System is the default and follows the OS live), help, and a Commands button that lifts the command reference over the page.
  - **Settings** open as a full overlay with a ✕, over the page you were on.
  
  Every existing view keeps its route and deep links (`/zones`, `/prd/<id>`, `/hench-runs/<id>`); the tab of the stage that lists a view stays lit on its page. Fixed-position toasts and trays are lifted clear of the bottom bar.

- [#469](https://github.com/en-dash-consulting/n-dx/pull/469) [`aa0ca02`](https://github.com/en-dash-consulting/n-dx/commit/aa0ca024713788ec46248f12df84e7390c64e2c7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard: `GET /api/llm/config` reports what `ndx work` will actually run.
  
  The response gains an `effective` block — `{ vendor, provider, model,
  modelSource }` — describing a flagless run. Until now the route returned
  configured keys and left the reader to perform the resolution over them, which
  is the step that goes wrong: the answer is assembled from `llm.vendor`, the
  `llm.*` model fields, `hench.provider` and `hench.models.<vendor>` across two
  files, and the rungs are not in the order anyone guesses. A page showing
  `llm.claude.model` can name a model the agent loop does not use, because
  `hench.models.claude` outranks it and only `ndx work` reads it.
  
  `modelSource` names the winning rung using llm-client's exported `ModelSource`
  union rather than restated literals, minus `cli-override` — a request carries
  no `--model`, so the route can never observe that rung. `provider` is
  `hench.provider` after the same switch `cmdRun` applies: a vendor with no CLI
  (google, local) auto-switches `cli` to `api`.
  
  Web cannot import hench, so `packages/web/src/server/effective-agent-config.ts`
  is a separately maintained twin of hench's `resolveAgentModel` and provider
  gate. Only the rung *ordering* is copied — every rung's computation is called
  from `@n-dx/llm-client`, which both packages share. A fixture matrix across
  all four vendors and nine config shapes runs both sides and compares
  (`tests/integration/effective-agent-config-contract.test.js`).
  
  hench exports `resolveAgentModel` (plus its parameter and result types, and
  `HenchAgentModels`) from its public API for that contract test, the same reason
  `VENDOR_PROVIDERS` is already exported: not to be called at runtime, but so the
  copy web is forced to keep can be checked against the original.
  
  A `hench.models` map with any entry hench's schema rejects — an unknown
  vendor key, a non-string, an empty string — is discarded whole rather than
  filtered, because that is what hench's own config salvage does with an
  invalid optional field. Keeping the good entries would report an override
  `ndx work` does not apply, which `ndx config hench.models.gemini …` (the
  vendor is `google`) makes easy to hit.
  
  Two configurations resolve but would refuse to run — `vendor=codex` with
  `provider=api`, and a model pinned for a vendor that cannot run it. The route
  reports the resolution rather than throwing, because a settings page that 500s
  on a bad saved value is one you cannot use to fix it.

- [#469](https://github.com/en-dash-consulting/n-dx/pull/469) [`aa0ca02`](https://github.com/en-dash-consulting/n-dx/commit/aa0ca024713788ec46248f12df84e7390c64e2c7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `GET /api/llm/config`'s `effective` block now reads `hench.provider` and
  `hench.models.<vendor>` from `.n-dx.json`/`.n-dx.local.json`, not only from
  `.hench/config.json`.
  
  hench's own help documents `hench.models.<vendor>` in `.n-dx.json` as the way
  to pin the agent's model, and the dashboard's Robot Wrangler page saves there
  too — but `resolveEffectiveAgentConfig` only ever read `.hench/config.json`,
  so the settings page could report a model `ndx work` would not actually use.
  It now merges the `hench` sections of both override files in with
  `.hench/config.json` the same way hench's own `loadConfig` does: an invalid
  merged field (an unknown vendor key, an empty model string) reverts to the
  `.hench/config.json` value rather than dropping the override silently.
  
  The contract test now runs hench's side through its own config loader instead
  of handing `resolveAgentModel` a `models` literal, and its matrix adds cases
  for each override file, both files set at once, and an invalid override.

- [#439](https://github.com/en-dash-consulting/n-dx/pull/439) [`39c6d80`](https://github.com/en-dash-consulting/n-dx/commit/39c6d80441aba2c3dd71d94494b58bf42fc5a4a0) Thanks [@endash-shal](https://github.com/endash-shal)! - The per-user directory the hub keeps its registry, pid and config in is now `~/.ndx/`, resolved by `resolveNdxHome` alongside the project-layout resolver rather than spelled out at each site.
  
  Nothing moves on an existing machine: the lookup takes `$NDX_HOME`, then `$N_DX_HOME`, then `~/.ndx` if it exists, then `~/.n-dx` if it exists, and only a machine with neither starts on `~/.ndx`. A 0.7.x install keeps using `~/.n-dx` until it is migrated. An empty override is treated as unset.
  
  `ndx start` now passes the resolved directory to a hub it spawns as `$NDX_HOME`, and the hub reports a bad config key by naming the resolved file rather than a tilde path that may not be the one in force.

- [#447](https://github.com/en-dash-consulting/n-dx/pull/447) [`25ad2a7`](https://github.com/en-dash-consulting/n-dx/commit/25ad2a75b26970c713d7d5d99f01210ce937eb55) Thanks [@endash-shal](https://github.com/endash-shal)! - The hench config page (`/hench-config`) loads and saves on projects using the `.ndx/` layout, instead of answering 404.

- [#456](https://github.com/en-dash-consulting/n-dx/pull/456) [`bc2cce2`](https://github.com/en-dash-consulting/n-dx/commit/bc2cce2abe82ba2b406f31731fa28bbdaa822dcb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Home names the next command instead of showing dashes on a never-analysed
  project. A next-step panel above the three stage cards reads one of four
  states: not initialised (`{cli} init`), initialised but not analysed
  (`{cli} analyze`), analysed with no PRD yet (`{cli} plan`), or a PRD present
  (the next task's title and `{cli} work`). The command always names the
  project's configured CLI, never a hardcoded `ndx`.
  
  `/api/status` gains one boolean, `initialized` — reusing the same check
  `routes-static.ts` already uses to gate the dashboard vs. the setup-wizard
  landing page — because `sv.freshness`/`rex.exists`/`hench.configured` alone
  can't tell a project `ndx init` never touched apart from one it has but
  hasn't analysed: both read as `unavailable`/`false`/`false`.
  
  `useProjectStatus` also now shape-checks the `/api/status` body once, in
  `fetchStatus`, rather than trusting an unchecked cast. A body missing a
  section, or carrying a malformed one (`rex.stats = {}`), is now discarded
  wholesale — treated the same as a failed fetch — rather than rendered
  piecemeal, which is what lets the next-step panel compute one of its four
  states without also having to guard against a half-populated object.
  
  A slot below the panel is reserved, empty, for the preflight card.

- [#471](https://github.com/en-dash-consulting/n-dx/pull/471) [`d339e94`](https://github.com/en-dash-consulting/n-dx/commit/d339e94af0d2e1be02c66305bf5e473633d53e6d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Serve the hub's project chooser at a fixed `/hub`, and answer `/api/hub/*` under a worktree slot.
  
  `/` is the chooser only while two or more projects are registered; with one it opens that project's dashboard, so a dashboard had no stable address to link back to. `/hub` and `/hub/` now return the chooser whatever is registered, while `/` keeps its single-project alias. A WebSocket upgrade at `/hub` is refused rather than forwarded to a project that never served the page.
  
  The hub also now answers its own API under a worktree slot — `/w/<key>/api/hub/*` and `/p/<id>/w/<key>/api/hub/*`. The viewer's base path carries the slot on a worktree page and `installBasePathFetch` puts it on every root-relative fetch, so those requests were being proxied to a project server that 404s on them. Because the run-queue strip reads a 404 as "there is no hub", the strip was silently empty on every worktree page rather than reporting an error. The slot is dropped before dispatch, since no hub answer is per worktree; the project prefix still scopes the queue to that project.
  
  `HUB_PATH` is defined once in `src/shared/base-path.ts` and read by both the hub's routing and the viewer's `hubUrl()`.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the analysis page at `/live/analyze`: the six phases with what each does, its result once done and its time against the previous run of the same mode; enrichment passes 0 to 4 under Zones with the current batch and judgment-cache reuse; the stdout tail with follow (dashboard-started runs); model calls by task class and cost so far; the `.sourcevision/` files written; notes and recent analyses. Terminal- and dashboard-started analyses update within two seconds. `GET /api/live/analyze` serves the page, and `POST /api/live/analyze/stop` stops a terminal-started analysis by its recorded pid. `sv analyze` now records its command and the last error line in `analyze-progress.json`, and on SIGTERM or SIGINT marks the open phase as an error in the manifest, records the run as failed and exits 128 + the signal, so a stopped analysis names the phase it stopped in.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live strip's "worktrees with a live run" and the Home pill's "running" count now go by each run's liveness verdict, so an abandoned record (`orphaned`) or another machine's run (`foreign`) is no longer counted as executing. It still shows under Needs attention.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `GET /api/live`: running hench runs from every worktree of the repository, running long jobs (including an analysis started from a terminal), the next tasks, a machine strip (agent slots, free memory against the hub floor, configured model, worktree count, spend today and in flight) and runs finished in the last hour. A `live:changed` WebSocket frame fires when a run or job starts, finishes or goes stale. The 5-minute stuck-run rule now lives in one place, so the bottom bar, runs health, audit and Live counts agree.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live tab, bottom bar, running-now bar and Live overview now share one live feed: one fetch, one WebSocket and one poller, so leaving /live no longer stops the others updating. The socket reconnects with backoff after it closes.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live tab, its running-now bar and the Home pill no longer count a run recorded on another host as running: the running count is runs judged live plus long jobs, so a foreign record alone leaves the tab idle.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live strip's first tile is now labelled "Hench slots" (was "Agent slots"), since every slot it counts is a hench run.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live Log tab no longer shows lines twice when a log read takes longer than its 500 ms poll: only one read is in flight at a time, and a tick that lands mid-read schedules one follow-up. A log that ends inside a multi-byte character no longer makes the tab re-request the same offset in a tight loop.

- [#482](https://github.com/en-dash-consulting/n-dx/pull/482) [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `GET /api/llm/catalog` serves a live model list, the installed CLI version and each vendor's default model.
  
  Each vendor entry gains `source` (`"live"` or `"built-in"`), `checkedAt` and,
  for the built-in list, a `reason`; `defaultModel` is what `ndx work` runs with
  no `hench.models.<vendor>` set. The claude and codex entries list from the
  vendor's Models API when a key resolves, and fall back to the built-in list
  with no key, on error or after 5s, so the route never fails because of it.
  They also gain `cli: { found, version, path }` from `<binary> --version`,
  resolving the binary as runs do (`CLAUDE_CLI_PATH`, `cli.claudePath`,
  `llm.codex.cli_path`, including `.n-dx.local.json`).
  
  Results are cached per vendor for 10 minutes. `?refresh=true` refills the
  cache and a successful `PUT /api/llm/config` clears it.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Live shows each run's liveness verdict: Needs attention lists orphaned and unknown runs from every worktree with the server's reason, "End N dead runs" and a one-run End (unknown runs after a confirm) go through the reconcile route, and foreign runs are shown but never endable. The Live tab, running-now bar and task page read an orphaned run as not running. Work's Active Tasks panel shows the verdict and links to Live instead of ending runs.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Behind the hub, the Live strip's agent-slots tile no longer reports fewer runs in use than the repository's live run list: in-use is the larger of the hub's dashboard-session count and the runs judged live across the repository's worktrees.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live strip's agent-slots tile now covers the same runs as the run list beside it. Standalone, it counts runs judged `live` in every worktree of the repository, terminal-started ones included, against hench's configured limit. Served through the hub, it shows the hub admission gate's sessions, `maxSessions`, and its queue when anything is waiting. The tile's label says which: "this repository" or "this machine".

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Live machine strip and live analysis page now report the vendor and model `ndx work` actually runs (default vendor and `hench.models` overrides applied), matching GET /api/llm/config's effective block.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Live task page with no task id no longer renders blank: `/live-task` opens the Live overview at `/live`. Opening Settings over `/live/task/X` and closing it returns to that task page. `[` and `]` do nothing while a modal dialog is open.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the running-task page at `/live/task/:taskId`: a header with run n of m and a run picker (the selected run is kept in the URL as `?run=`), chips for elapsed time, epic chain, priority, turn, tokens and tokens per second, model and heartbeat, plus Copy link, Mark stuck and Stop. The Work tab shows each progress event as it is written and keeps the current step in view, followed by the last five log lines. A side column shows the task's criteria, its runs, where the run is running, what it has spent and what happens after it. `GET /api/live/task/:taskId` serves the page's data. Stop now also stops runs started from a terminal, using the pid on the run record. It does this only when the record is from this host and its heartbeat is fresh.

- [#469](https://github.com/en-dash-consulting/n-dx/pull/469) [`aa0ca02`](https://github.com/en-dash-consulting/n-dx/commit/aa0ca024713788ec46248f12df84e7390c64e2c7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Resolve the legacy top-level `claude.*` keys against `llm.claude.*` **per
  field**, and stop writing the legacy copies.
  
  **Behaviour change.** A project carrying both an `llm.claude` block and legacy
  `claude.*` keys now honours each legacy field the new block leaves unset. The
  fallback used to be block-level (`llmClaude ?? legacyClaude`), so a modern block
  holding a single field discarded every legacy field beside it — a project that
  set `claude.api_key` once and later pinned `llm.claude.model` silently lost the
  key, and `claude.lightModel` silently reverted to the tier default. Nothing said
  so, because both states are valid config.
  
  `resolveClaudeConfig` in `@n-dx/llm-client` is the one implementation of that
  rule, exported alongside a `sources` map saying where each resolved field came
  from. `loadLLMConfig`, `GET /api/llm/config` and `GET /api/ndx-config` all use
  it, so the CLI, the dashboard and the footer can no longer disagree about which
  value is live.
  
  Two further consequences of reading the resolved view:
  
  - The dashboard footer's auth check (`GET /api/ndx-config`) now counts a
    credential set under `llm.claude.api_key` / `llm.claude.cli_path`. It read
    only the legacy block before, and reported `authMethod: "none"` for a
    perfectly configured project — it happened to work solely because
    `packages/core/config.js` mirrored modern writes back into the legacy keys.
  - That mirror is gone. `ndx config llm.claude.<field>` now writes only
    `llm.claude.<field>`. Existing `claude.*` values are deliberately left where
    they are: they are still read until 1.0.0, so rewriting or removing them would
    change what a project resolves without being asked to. The local-file
    migration still clears a legacy *secret* from the shared file, because a key
    mirrored there by an older version must not stay committed.
  
  Readers that leaned on that mirror move with it. `ndx config --test-connection`
  resolves both locations per field, so it tests a credential stored under
  `llm.claude.cli_path` / `llm.claude.api_key` instead of reporting "No Claude
  configuration set" for a fully configured project. `ndx auth` already resolved
  both and is unchanged. `loadClaudeConfig` in `@n-dx/llm-client`, which supplies
  the API key, CLI path and endpoint to `ndx work` on the API provider and to rex's
  LLM commands, resolves both locations the same way, so a key set with
  `ndx config llm.claude.api_key` reaches them.
  
  Not yet moved: `ndx config claude.<field>` as a *read*, the whole-section
  `ndx config claude`, and the `claude` block in `ndx config --json` still answer
  from the legacy key alone, so they no longer surface a value set under
  `llm.claude.*`. Read it under its own name (`ndx config llm.claude.<field>`)
  until that migration lands.
  
  Writes go to the modern keys only. `PUT /api/llm/config` refuses `claude.model`
  and `claude.lightModel` with a 400 naming the `llm.claude.*` replacement, rather
  than the generic unknown-path error those keys would otherwise get.
  
  `GET /api/ndx-config` also stops falling back to `hench.model` for the displayed
  model. `ndx work` has never read that key, so the footer could name a model
  nothing would run.
  
  One sharp edge worth stating: a legacy `claude.model` that is incompatible with
  the active vendor was previously masked whenever any `llm.claude` block existed,
  and is now resolved — so `ndx work` reports it with the same actionable error a
  bad `llm.claude.model` already gets, instead of silently running the default.

- [#445](https://github.com/en-dash-consulting/n-dx/pull/445) [`cceceb5`](https://github.com/en-dash-consulting/n-dx/commit/cceceb563ba1650f4e70b9cbe63eec9bbd954e4d) Thanks [@endash-shal](https://github.com/endash-shal)! - Retry a layout-save rename that Windows refuses
  
  The preview server writes the layout through a uniquely-named temp file and
  serialises renames per target, which removes the collisions it causes itself.
  It cannot remove the ones it does not own: a browser or editor holding the
  layout file, a backup agent, an indexer or a virus scanner all make Windows
  refuse the rename outright rather than wait, and the save answered 400. A
  full-suite run caught exactly that — one 400 among twenty concurrent saves that
  were all valid.
  
  The rename now retries ten times at 50ms while the error is EPERM, EACCES or
  EBUSY. A non-transient error is not retried, and one that outlasts every
  attempt still surfaces as a 400.

- [#442](https://github.com/en-dash-consulting/n-dx/pull/442) [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Refuse whole-tree PRD rewrites off the default branch without `--allow-on-branch`.
  
  `reshape`, `reorganize`, `prune`, the `migrate-*` commands, and
  `import-bundle --replace` each rewrite the entire `.rex/prd_tree/` in one
  pass. Run on a feature branch, that rewrite has repeatedly ridden into `main`
  inside an unrelated pull request. These commands now refuse to run off the
  repository's default branch (the branch `origin/HEAD` names, else
  `main`/`master`) unless `--allow-on-branch` is passed; the refusal names the
  branch and the flag. Read-only previews (`--dry-run`, and `reorganize`
  without `--accept`) still run anywhere. A tree with no resolvable git branch
  (no repo, or git unavailable) is unaffected — the guard only fires on a real,
  named feature branch.
  
  `packages/rex/src/core/branch-guard.ts` is the shared guard, wired into each
  of the six affected `cli/commands/*.ts` files. `hench`'s interactive
  `migrate-slugs` offer and the dashboard's equivalent tree-conformance-gate
  route both already gate the migration behind an explicit human confirmation,
  so both now pass `--allow-on-branch` through to carry that consent — neither
  flow's behavior changes.

- [#442](https://github.com/en-dash-consulting/n-dx/pull/442) [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `rex tree-diff` (`ndx tree-diff`) to compare two PRD trees.
  
  The diff is by item id over the flattened trees, into `added`, `changed`,
  `completed`, `moved` and `removed`, each entry carrying the item's ancestor
  chain so a bare id does not have to be looked up to be understood. Because
  it keys on the id, a reparented item is reported once as `moved` — with both
  its old and new chains — rather than twice as an unrelated removal and
  addition.
  
  With no flags it compares this checkout's working tree against the default
  branch, which answers "what has this branch done to the PRD". `--from=<ref>
  --to=<ref>` compares two commits, `--against=<dir>` compares two checkouts on
  disk (a worktree against its anchor), and `--json` prints the machine-readable
  form. Identical trees produce an empty diff. A ref from before the PRD tree
  existed reports `present: false` rather than reading as a tree-sized list of
  additions.
  
  The command is read-only: it takes no PRD lock and writes nothing, so it can
  be run while another command is writing the tree. Reading the tree at a ref
  materialises it into a temp directory through a single
  `git checkout` with `GIT_INDEX_FILE` pointed at a throwaway index, so the
  caller's index and working tree are untouched.
  
  The dashboard's Workspaces PRD delta now computes through the same
  `diffTrees` engine rather than its own copy of the id-indexing and
  field-comparison loop — its published payload is unchanged, but the CLI and
  the dashboard can no longer disagree about the same pair of trees.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Demo page landing: the page opens on three stage columns side by side — Analysis, Plan, Work — each headed by its package mark (the SourceVision, Rex and Hench images, inlined as data URIs so the static export stays self-contained), with one line on what it is for and its headline numbers. Clicking a column goes to that stage; the logo brings you back. The columns and the side stage links share one hover highlight. PRD Items (progress, open epics) and the execution-log History move from the Analysis page to the Work page, above Templates.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Demo page theme: a System · Light · Dark control in the bottom bar replaces the two-way theme button in the demo banner. System is the default and follows `prefers-color-scheme` in CSS, so it holds with scripts off; Light and Dark pin the theme and are remembered. The static export carries the same control.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Demo page shell: the three stages (Analysis, Plan, Work) are tabs in a top bar beside the logo and project info. The bottom bar keeps the server status, a settings cog and a Commands button — Commands lifts a sheet over the current page with the runner and the full reference; the cog opens the settings pages as a full overlay with an ✕ to close. Each stage page carries two small vertical buttons on its edges that step around the loop (Analysis → Plan → Work → Analysis). The static exporter bakes the sheet and settings pages into their own hosts.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Preview editor: editing no longer scrolls you back to the top. Re-renders restore both scroll containers and the focused control, selecting a view updates only the highlight and the page instead of rebuilding the rail, and a change to the layout file on disk is swapped in place rather than reloading the page. The preview server also stops injecting its reload poller into a document that already watches `/__preview/state` — the two together were what turned every save into a full reload.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the `ndx start --preview` document an editor. The mock-up now renders from `index.layout.json` beside it and writes changes back over `POST /__preview/layout`: drag sections, tabs and panels to reorder them, drop one onto the middle of a group to nest it inside (so sections can be grouped into named dropdowns), rename anything — a rename renders as "New name (previously Old name)" — and add, cut or restore items. Moves, additions and removals are marked in place and collected into a change list for reviewers. The layout file is the artifact: hand-edit it instead of dragging if you prefer, and review it as a diff.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Preview: add `option1-demo.html`, a hand-built rendering of the option 1 layout filled with this repo's real analysis, PRD and run data — three product pages (Analysis, Plan, Work) of named dropdown sections, with the 2D and isometric zone graphs sharing one panel behind a toggle. Reachable from the editor header ("Demo ↗"). The preview server now serves sibling HTML pages with live reload and folds their timestamps into the change fingerprint, and the build copies every page in `src/preview/` into `dist/`.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Preview document: a nav section is now a page of its own. Folders carry content, so clicking a section in the rail opens it instead of only expanding it, and a page is a list of named, collapsible sections ("dropdowns") holding panels. Panels gained a stats mode — editable numbers with an optional hover explainer per stat — alongside the placeholder card. Panels move between sections by drag or the "move to…" picker, and sections reorder by dragging their header.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `pnpm preview:export` (`scripts/export-preview-demo.mjs`): writes the option 1 demo page as a static, self-contained HTML file with every page baked into the markup, so the numbers survive wherever scripts are blocked or stopped (mail and chat previews, reader mode, restored tabs). The exported file's own script only shows and hides — navigation, section collapse, the 2D/3D zone-graph toggle, theme.

- [#482](https://github.com/en-dash-consulting/n-dx/pull/482) [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard: analyze and plan settings, feature flags, Notion and integrations are now one Project settings page.
  
  The page (`/project`, in the settings list where analyze and plan settings were)
  renders on the shared settings frame: Save writes each changed section to its own
  endpoint, and a section whose write fails stays unsaved with its error shown.
  Feature flags now save with the rest of the page instead of on each click, and
  the dashboard is told about a flag only once it has been saved. Notion and
  Integrations appear on the page only while `rex.notionSync` / `rex.integrations`
  is on; testing, syncing, disconnecting and removing stay immediate buttons.
  
  `/project-settings`, `/feature-toggles`, `/notion-config` and `/integrations`
  redirect to `/project`. The export and refresh panels stay on the Commands
  page, which is now labelled "Commands".

- [#448](https://github.com/en-dash-consulting/n-dx/pull/448) [`0c362d7`](https://github.com/en-dash-consulting/n-dx/commit/0c362d78837139f79bef62aa08de01e2ea749abd) Thanks [@endash-shal](https://github.com/endash-shal)! - Run every async dashboard job through one shared job tray.
  
  The tray now tracks all seven background commands — full analysis, refresh,
  self-heal, `ndx ci`, reshape, recommend and Project Scan — alongside hench task
  executions, each with phase, elapsed time and a working Stop. Every one of
  those commands gained a `/stop` endpoint, and `rex recommend` became an async
  job rather than a multi-minute synchronous request. A finished run shows a
  result card linking to where its output landed.
  
  The per-view pollers those jobs used to run in Commands, Overview and
  Suggestions are gone: each view now reads the shared tray, so a job stays
  visible and stoppable from any view rather than only the one that started it.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `POST /api/hench/runs/reconcile`, which ends dead runs in every worktree of the repository. It ends runs whose verdict is `orphaned`, ends `unknown` runs only when `includeUnknown` is set, and never ends `live` or `foreign` runs. `dryRun` reports what would end without writing anything, and `runIds` limits the call to the named runs. Each run is re-checked just before it is written, so a run that has come back to life is left alone. Each worktree's runs are written to that worktree's own `.hench/runs/` with an atomic write, and the response groups the results by worktree. Mark stuck now writes the same terminal shape as reconcile: `status: "failed"`, `finishedAt`, and an error that starts with "Ended by audit reconciliation:".

- [#490](https://github.com/en-dash-consulting/n-dx/pull/490) [`d3c2169`](https://github.com/en-dash-consulting/n-dx/commit/d3c21692f2a8f7582a114fc69fba1c88a7a0205e) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard scrubs credential-shaped text from run records as it serves them (covering records written before hench redacted at save time) and from every command's output it shows — the live analysis stream, the output the full analysis leaves behind when it completes, and the quick analysis response, the last two of which previously overwrote or bypassed the scrub and surfaced raw stdout. The hub now spawns only `@n-dx/web`'s CLI entry point or an `ndx` launcher as a project server, refusing any other executable — and identifies that entry point by the owning package's `package.json` name rather than its path shape, so a file planted at a matching path is no longer accepted. The transitive `ip-address` dependency (via the MCP SDK's rate limiter) is pinned to a version without the published IPv6-classification advisories.

- [#456](https://github.com/en-dash-consulting/n-dx/pull/456) [`bc2cce2`](https://github.com/en-dash-consulting/n-dx/commit/bc2cce2abe82ba2b406f31731fa28bbdaa822dcb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add redirect aliases for the dashboard paths `0.8.0`'s navigation merge
  orphaned: `/overview` now redirects to `/analyze`, and `/rex-dashboard` to
  `/work` in the full dashboard (a rex-scoped standalone viewer, which has no
  Work stage, keeps `/rex-dashboard` as its own page). The alias table lives in
  `packages/web/src/shared/view-routing.ts` and is applied in three places: the
  server's SPA catch-all (`routes-static.ts`, preserving any sub-path and query
  string), the viewer's pathname/hash route parser, and in-app navigation
  (`navigateTo`/`handleSidebarNav`) — so the bottom bar's SourceVision and Rex
  status indicators, which still target the pre-merge view ids, land on the
  current stage too.
  
  `packages/web/tests/e2e-ui/navigation.spec.ts` (now a required test — see
  TESTING.md) takes its view list from the `VIEW_META` navigation model instead
  of a hand-kept copy that had drifted (it omitted `ask`), deep-links every
  view with feature-gated ones toggled on, and asserts both aliases resolve to
  their target with zero console errors.

- [#491](https://github.com/en-dash-consulting/n-dx/pull/491) [`161da3d`](https://github.com/en-dash-consulting/n-dx/commit/161da3d04bb668f80ffe1a52c3be880cdeafbab1) Thanks [@endash-shal](https://github.com/endash-shal)! - Show repository trust in the dashboard: a strip at the top of every page while the checkout's execution config is not trusted, with the findings and a "Trust this configuration" action (`GET /api/trust`, `POST /api/trust/accept`, `POST /api/trust/revoke`). `ndx start` prints the same review on startup when it applies.

- [#482](https://github.com/en-dash-consulting/n-dx/pull/482) [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard: replace the LLM Provider view with the Robot Wrangler settings page.
  
  The page (`/robot-wrangler`, first in the settings list) renders on the shared
  settings frame, so Save, the unsaved-changes indicator and the leave prompt
  replace the old save bar and toast. It shows what `ndx work` will run with —
  vendor, provider, model and which setting supplied it — and, when the run would
  be refused, says why. Claude model fields still read from the legacy
  `claude.*` keys are marked as such; saving writes `llm.claude.*`.
  
  `GET /api/llm/config` gains `effectiveProblems`, the reasons the resolved
  `effective` block would be refused (provider unsupported for the vendor, model
  not belonging to it). `/llm-provider` redirects to `/robot-wrangler`.

- [#482](https://github.com/en-dash-consulting/n-dx/pull/482) [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Robot Wrangler now offers each vendor only the providers hench accepts and replaces free-text model entry with dropdowns over the server's model catalog. An agent model picker saves `hench.models.<vendor>` (with "Use project default" and free entry), and the project and light model fields use the same list. The page shows where the list came from with a Refresh action, and the installed CLI version for Claude and Codex. `PUT /api/llm/config` accepts `hench.models.<vendor>` and now rejects an `llm.<vendor>.model` or `lightModel` the vendor cannot run. The hard-coded `MODEL_SUGGESTIONS` list is gone.

- [#453](https://github.com/en-dash-consulting/n-dx/pull/453) [`c3244ca`](https://github.com/en-dash-consulting/n-dx/commit/c3244cada1baa0347bf22563138baf98ee388c06) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Route hench's and the web dashboard's own `.rex`/`.hench`/`.sourcevision` file access through the folder-layout resolver instead of hardcoded paths.
  
  On a project that has migrated to the `.ndx/` container layout, several hench and web code paths previously composed `join(projectDir, ".hench", …)` / `.rex` / `.sourcevision` directly — the sourcevision primer and analysis-fingerprint reads, the retention-log and quota reads, hench's recovery pathspec files, the dashboard's server startup (`ctx.rexDir`/`ctx.svDir`), workspace (worktree) context construction, the worktree run-history route, the aggregation cache's fingerprint sources, the merge graph, token-usage analytics, the usage-cleanup scheduler, and the config/status/commands routes. On `.ndx/` projects these read and wrote nothing, silently: no primer, no fingerprint, no worktree runs, and the dashboard's "initialized" check never turned true. They now resolve through `resolveLayout`/`resolveHenchPaths`/`resolveWebPaths`, as does `hench validate-tokens`. Hench's git bookkeeping paths (the PRD commit and uncommitted-work checks) still assume the legacy layout and move with the follow-up sweep.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The run log route now returns the last bytes of a finished run's log even when they stop partway through a character. Those bytes show as U+FFFD and the response has `more: false`. Bytes that can never start a UTF-8 character are no longer held back.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Record the agent process pid on every run record.
  
  Hench now writes `pid` (its own process) and `vendorPid` (the vendor CLI subprocess while one is live) to the run record when the run starts, and the existing 30-second heartbeat refreshes them. Both are additive optional fields; records without them load normally and mean "pid unknown".
  
  `GET /api/hench/runs/health` reports `pid`, `vendorPid` and `pidAlive` beside the heartbeat age, so a slow run (old heartbeat, pid alive) can be told from a dead one (pid gone) whoever started it. `pidAlive` is `null` when no pid was recorded.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard server can now tail a hench run while it runs. `GET /api/hench/runs/:id/log?from=<byte offset>` returns the run log from a cursor and `GET /api/hench/runs/:id/events?after=<seq>` returns the progress events after one. Each response carries the next cursor. The run can be in any worktree of the repository. Files are served only from `.run-logs/` or `.hench/runs/` of a worktree that `git worktree list` reports; any other path, including a symlink out of those directories, gets a 404. Runs recorded before the incremental log return their end-of-run log. While a client is tailing a running run, the server pushes a workspace-tagged `hench:run-appended` WebSocket frame within about a quarter second of the log or event stream growing.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Run tail routes no longer serve files through a symlinked `.run-logs/` or `.hench/` directory. A repository can commit `.run-logs` as a link to anywhere (for example `~/.ssh`), which used to move the allowed area there; such a request now answers 404 like any other refused path.

- [#440](https://github.com/en-dash-consulting/n-dx/pull/440) [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91) Thanks [@endash-shal](https://github.com/endash-shal)! - Enforce feature toggles on the server, not only in the sidebar
  
  A toggle that only hid a nav entry left its endpoints open to anything that
  could reach the port. Turning off `sourcevision.ask` — the one toggle over a
  token-spending endpoint — hid the panel but left its two write endpoints
  (`/api/rex/capture-ask`, `/api/rex/apply-refinements`) reachable; the same held
  for the PR Markdown, Notion and Integrations surfaces.
  
  Every endpoint governed by a toggle is now declared in
  `server/route-feature-gates.ts` and refused with a 403 naming the flag, before
  dispatch. A test fails if a nav `featureGate` gains no server entry, so a
  toggle cannot go back to being nav-only.

- [#506](https://github.com/en-dash-consulting/n-dx/pull/506) [`43b75d8`](https://github.com/en-dash-consulting/n-dx/commit/43b75d82fcaab1bcbb1611b1faa763280bc8c2ab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Settings pages and the Settings gear now use 8-bit pixel-art icons in the settings overlay sidebar, its header and the bottom-bar settings button. Robot Wrangler's text glyph changes from a brain to a robot.

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Scoped viewers no longer show bottom-bar status indicators for views outside their scope; Token Usage is listed by the Work stage only, so opening it from Work keeps Work active; the preview server answers a malformed percent-escaped asset URL with 404 instead of crashing, and overlapping layout saves each use their own temp file.

- [#447](https://github.com/en-dash-consulting/n-dx/pull/447) [`25ad2a7`](https://github.com/en-dash-consulting/n-dx/commit/25ad2a75b26970c713d7d5d99f01210ce937eb55) Thanks [@endash-shal](https://github.com/endash-shal)! - List every hench setting on the Workflow page and in `hench config`
  
  `ndx config`, `hench config` and the dashboard's Workflow page each kept their own
  hand-written list of hench settings, and the three had drifted. `hench config` was
  missing sixteen documented keys — `promptCacheTtl`, the whole `prune` and test-gate
  groups, the git-safety pair, session reuse — and the Workflow page was missing those
  plus the guard keys the CLI already had. One of them, `guard.memoryMonitor.spawnThreshold`,
  is named in the message hench prints when it throttles a spawn, so the suggested
  `hench config` command answered "Unknown config key".
  
  All three surfaces now offer every key hench's schema defines, grouped into Session
  Reuse, Context Prune, Test Gate and Git Safety alongside the existing categories.
  `tests/e2e/hench-config-gate-contract.test.js` compares the lists and pins each
  recorded default against hench's own, so they cannot drift apart again.
  
  Also fixed:
  
  - The dashboard can now edit `prune.*`. Its write gate was per-field and could not see
    that hench refuses a config whose `prune.retainPairs` reaches its `prune.triggerPairs`;
    a new sibling-constraint check runs on the finished config, after group completion, on
    every write path.
  - The gate understands `min`/`max` bounds, so it no longer accepts a memory threshold
    above 100 that hench would then refuse.
  - `language: "swift"` was rejected by hench's own config schema even though `hench init`
    writes it for a Swift project.
  - The Workflow page appends any category it does not recognise instead of dropping it,
    and `hench config --interactive` no longer offers "1-5" when there are nine categories.

- [#482](https://github.com/en-dash-consulting/n-dx/pull/482) [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A dashboard served without the hub no longer logs a 404 for `/api/hub/projects` on every page. The project server now answers it with `{ "hub": false }`, which the breadcrumb's project switcher already treats as "no hub".

- [#425](https://github.com/en-dash-consulting/n-dx/pull/425) [`2e58d8e`](https://github.com/en-dash-consulting/n-dx/commit/2e58d8e16e09a630f7c867f0a0463610625102a5) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `ndx start --preview`: serves a hand-editable UI layout document (`packages/web/src/preview/index.html`) on port 3118 with live reload, for reshuffling dashboard sections before touching components. It runs no analysis, exposes no MCP endpoints and writes nothing under `.rex/` or `.sourcevision/`, keeps its own `.n-dx-preview.pid`/`.port` files, and relocates rather than killing a port occupant — so it is safe to run alongside a real `ndx start`. `--file=<path.html>` serves a different document.

- [#436](https://github.com/en-dash-consulting/n-dx/pull/436) [`03590e4`](https://github.com/en-dash-consulting/n-dx/commit/03590e4fa8069232774dce4e1d0fe460b969e530) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a folder-layout resolver and a paths module per package.
  
  n-dx keeps its state in three dot-directories and five loose `.n-dx*` files, named
  directly at roughly 380 source files. `resolveLayout` in `@n-dx/llm-client` makes that
  one decision in one place: it reads a `.ndx/` container first and falls back to the
  legacy layout silently, so existing projects keep working untouched. Each package gains
  a paths module (`resolveRexPaths`, `resolveSourcevisionPaths`, `resolveHenchPaths`,
  `resolveWebPaths`) as the single home for its own folder names, and the orchestration
  tier gets a hand-written twin in `packages/core/layout.js` — it may not import from any
  package tier — pinned to the canonical implementation by a contract test.
  
  No call sites are rewired yet, so behaviour is unchanged.

- [#456](https://github.com/en-dash-consulting/n-dx/pull/456) [`bc2cce2`](https://github.com/en-dash-consulting/n-dx/commit/bc2cce2abe82ba2b406f31731fa28bbdaa822dcb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard: merge the Analysis stage's Map, Isometric map and Zones into one
  tabbed Terrain section, and Architecture and Routes into one tabbed
  Architecture section.
  
  The Analysis stage showed the repository map (with a 2D/3D toggle to the
  isometric map), Zones, Architecture and Routes as four separate collapsible
  sections. `StageSection.alt` — the old two-way 2D/3D toggle — generalises into
  `tabs`, an ordered list of further views sharing a section; each tab is still
  the same view, unchanged, reused as its own route and full page. The tab strip
  is a proper ARIA tablist (`role="tab"`/`"tabpanel"`, `aria-selected`,
  roving-tabindex arrow-key navigation), replacing the toggle's plain pressed
  buttons. Terrain has no page of its own, so its heading comes from a new
  per-section `group` override; the merged Architecture section keeps the
  `architecture` view's own name, needing no override. A section's "Open" link
  still opens whichever tab is active. The isometric map tab stays hidden in a
  static export, the same exemption the old toggle's 3D side carried.
  
  Rex's merge graph (`merge-graph`) is relabelled **PRD Graph**; it was
  **Context Graph**. Its heading, display-mode control, screen-reader label and
  the link to it from the PRD view all use the new name.

- [#434](https://github.com/en-dash-consulting/n-dx/pull/434) [`66705e6`](https://github.com/en-dash-consulting/n-dx/commit/66705e69a1d66651644ef9a5f5ff684669ebf2e9) Thanks [@endash-shal](https://github.com/endash-shal)! - Record the session strategy, hit/miss reason and token-data provenance on every run.
  
  Every run record now carries a `session` field naming which session strategy ran
  (`fork` / `batch` / `cold`), whether the cache served it, the named reason it did or
  did not, and how old the entry was. `hench show` and the end-of-run summary print it
  as one line; the dashboard's run detail gains a Session section. Until now the only
  trace of that decision was a terminal line nobody was capturing, so "is batching
  actually hitting?" could not be answered from run history.
  
  API-provider runs record the decision too, as `cold` / `api-provider` — that path holds
  no session resumable by id, and saying so is not the same as saying nothing, which is
  also what a run that died before reaching the decision looks like.
  
  Cache token counts now say where they came from. `tokens.cachedProvenance` and the
  per-turn `cacheProvenance` distinguish a vendor that accounted for caching and
  reported none from a vendor that never reported it at all — both of which used to
  read as a confident `cached: 0`.
  
  Fixes two places where Codex cache data was dropped: the token parsers ignored
  Codex's `cached_input_tokens` / `cache_write_input_tokens` field names, and the Codex
  JSONL event parser kept only input and output from a turn's `usage`. A Codex turn
  reporting 45,472 input with 35,072 cached is now split correctly rather than counted
  entirely as uncached input — the total is unchanged, the attribution and the price
  are not.
  
  All fields are additive; run records written before this change load unchanged.

- [#454](https://github.com/en-dash-consulting/n-dx/pull/454) [`d6a6c0c`](https://github.com/en-dash-consulting/n-dx/commit/d6a6c0c0d0f01674e58b8eddd9855909787b01fa) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Fix the branch guard, `rex tree-diff` and SourceVision's PR markdown in the cases the 0.8.0 B2 review found.
  
  - A stale `origin/HEAD` (one that still names a pruned branch, such as `origin/master` after a rename) is no longer trusted. The branch guard and a bare `rex tree-diff` check the ref exists and otherwise fall back to `main`/`master`, so a user on `main` is no longer refused on their own default branch.
  - `rex tree-diff` no longer runs the repository's git hooks when it extracts a tree at a ref, so a failing or slow `post-checkout` hook can't break it.
  - When the baseline ref predates the PRD tree, `rex tree-diff`'s text output now says so instead of listing every item as added.
  - `sv pr-markdown` warns when either side of the diff has no PRD tree, instead of rendering an empty or whole-project Completed Work section. It no longer forces a local `main` as the base: without an explicit base branch it uses tree-diff's default (`origin/HEAD`, then `main`/`master`) and reports the base tree-diff actually used.
  - hench's slug-migration offer and the dashboard's migration route no longer bypass the branch guard. On a feature branch they show rex's refusal, naming the branch.
  - `rex ready --item` without a value, including the space-separated `--item <id>`, now refuses and names `--item=<id>`, as `rex log` and `rex export` already do.

- [#488](https://github.com/en-dash-consulting/n-dx/pull/488) [`61ad331`](https://github.com/en-dash-consulting/n-dx/commit/61ad3313312e3e2dd5c2cccc0a4c21056fa50ebe) Thanks [@endash-shal](https://github.com/endash-shal)! - Validate the `Host` header on every hub, dashboard and preview request. A WebSocket upgrade whose `Host` does not name the hub is answered `421 Misdirected Request`, matching the HTTP path and the project server's own upgrade handler, rather than `403 Forbidden`.

- [#449](https://github.com/en-dash-consulting/n-dx/pull/449) [`ccad056`](https://github.com/en-dash-consulting/n-dx/commit/ccad05698ce562b0ae47b283a59854b299884f5c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `GET /api/llm/catalog`, serving per-vendor model lists and the provider
  choices hench accepts (claude cli or api, codex cli only, google api, local
  api), so the dashboard's model picker no longer drifts from llm-client's
  catalog or hench's own provider rules.
  
  Cloud-vendor models come from llm-client's `TIER_MODELS`/`MODEL_COSTS`
  catalog; local models come from a live probe of the configured local server
  (empty list with a `reason` when unreachable, never an error). Provider
  choices come from a new `VENDOR_PROVIDERS` table in
  `packages/hench/src/cli/commands/provider-support.ts` — extracted from
  `cmdRun`'s ad hoc provider checks in `run.ts`, now table-driven and re-exported
  from hench's public API. Web cannot import hench at runtime, so
  `packages/web/src/server/hench-config-fields.ts` keeps a separately maintained
  copy of the same table; `tests/integration/cross-package-contracts.test.js`
  pins the two together.
  
  The dashboard's hench-config save path (`PUT /api/hench/config`, plus the
  adaptive apply/override routes) now rejects a `provider` value the active
  vendor does not support, naming the vendor and its allowed providers.
  
  No viewer changes — the picker UI and `MODEL_SUGGESTIONS` removal are a
  separate change.

- [#500](https://github.com/en-dash-consulting/n-dx/pull/500) [`0bca3ea`](https://github.com/en-dash-consulting/n-dx/commit/0bca3ea0f0336ec4f317504fb518320c6ac6856d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The dashboard's memory status and the hub's admission floor now use the shared available-memory reading from `@n-dx/llm-client` instead of `os.freemem()`. On macOS that counts the inactive, speculative and purgeable pages the OS hands back on demand, so a healthy 16 GB Mac that read 115 MB free (dashboard "critical" at 99% used, and below the hub's 2 GB floor, which queued every dashboard-started run) now reads the ~3.9 GB it can actually give out and starts the run. Linux and Windows are unchanged — `os.freemem()` is already the available figure there.
  
  `GET /api/hench/memory` keeps its fields and adds `system.availableBytes`, `system.pressure` and `system.source`; `system.freeBytes` carries the available reading. A machine whose memory cannot be read at all reports health `"unknown"` with `freeBytes`, `usedBytes` and `usedPercent` null, the memory panel shows a dash and "Memory reading unavailable" with no warning styling, and the hub admits rather than queuing — nothing flags, throttles or holds a run on a reading that does not exist. The hub's queue snapshot gains `availableBytes` and `pressure`, and the panel and queue copy now say "available" rather than "free".
  
  The Live tab's machine strip shares the same reading: `GET /api/live`'s `machine.memory` gains `availableBytes`, `pressure` and `source` alongside its existing fields, with `belowFloor` computed against an explicit null check (`null <= floor` is `true` in JavaScript, which used to flag an unreadable machine as below the floor). The tile itself — labelled "Memory" — now shows the pressure level (Normal / Warn / Critical / Unknown) as its value and `<available> available · floor <floor>` as detail, and is outlined only for warn/critical pressure or a known reading at or below the floor — never for an unknown one, which was the bug: a healthy 16 GB Mac with ~3.9 GB reclaimable showed "Free memory 144 MB" outlined in orange against the hub's 2 GB floor.

- [#496](https://github.com/en-dash-consulting/n-dx/pull/496) [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `GET /api/live` and `GET /api/hench/runs/health` report `liveness`, `livenessReason` and `canEnd` for each running run, in every worktree of the repository, with a per-verdict summary (`counts.liveness` and `liveness`). The verdict follows hench's rules — host, then the recorded pid and heartbeat, then that worktree's lock files — and a run the dashboard still holds as a child process is `live`. `runs/health` now spans every worktree and tags each run with its `worktree`. The web server has one `isPidAlive`, counting EPERM as alive.

- [#482](https://github.com/en-dash-consulting/n-dx/pull/482) [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Dashboard: work settings, CLI timeouts and templates are now one Workflow settings page.
  
  The page (`/workflow`, in the settings list where the work settings were)
  renders on the shared settings frame: Save writes each changed part to its own
  endpoint, and a part whose write fails stays unsaved with its error shown.
  Templates still apply immediately; Apply and Save as template are disabled
  while the page has unsaved changes, and applying a template refreshes the work
  settings. Provider and model are no longer edited here — a link points to
  Robot Wrangler, which owns them. Templates are no longer a section of the Work
  stage.
  
  `/hench-config`, `/cli-timeouts` and `/hench-templates` redirect to
  `/workflow`. The `ndx config` help for `llm.local.timeoutMs` names the new page.
- Updated dependencies [[`0f927d1`](https://github.com/en-dash-consulting/n-dx/commit/0f927d1c8026fb17d997b2e6b83d017795f8898a), [`21e086d`](https://github.com/en-dash-consulting/n-dx/commit/21e086d6bade2453e179578ab3c5a102a1f445b6), [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918), [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918), [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918), [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50), [`66705e6`](https://github.com/en-dash-consulting/n-dx/commit/66705e69a1d66651644ef9a5f5ff684669ebf2e9), [`0f927d1`](https://github.com/en-dash-consulting/n-dx/commit/0f927d1c8026fb17d997b2e6b83d017795f8898a), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`05a8115`](https://github.com/en-dash-consulting/n-dx/commit/05a811560a19baf95e69bc19a8c906dad2b3fea9), [`39c6d80`](https://github.com/en-dash-consulting/n-dx/commit/39c6d80441aba2c3dd71d94494b58bf42fc5a4a0), [`f31ece3`](https://github.com/en-dash-consulting/n-dx/commit/f31ece3356eeb3450f62e3ffcebde43852c61bd6), [`6a07165`](https://github.com/en-dash-consulting/n-dx/commit/6a07165eb8bdc87e2cf28a7c657a04905faa0918), [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f), [`39c6d80`](https://github.com/en-dash-consulting/n-dx/commit/39c6d80441aba2c3dd71d94494b58bf42fc5a4a0), [`d6a6c0c`](https://github.com/en-dash-consulting/n-dx/commit/d6a6c0c0d0f01674e58b8eddd9855909787b01fa), [`ccad056`](https://github.com/en-dash-consulting/n-dx/commit/ccad05698ce562b0ae47b283a59854b299884f5c), [`0e3623e`](https://github.com/en-dash-consulting/n-dx/commit/0e3623edbc25e417982a93db53aa7ae6b70fae2f), [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91), [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91), [`aa0ca02`](https://github.com/en-dash-consulting/n-dx/commit/aa0ca024713788ec46248f12df84e7390c64e2c7), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50), [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50), [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50), [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91), [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91), [`d3c2169`](https://github.com/en-dash-consulting/n-dx/commit/d3c21692f2a8f7582a114fc69fba1c88a7a0205e), [`161da3d`](https://github.com/en-dash-consulting/n-dx/commit/161da3d04bb668f80ffe1a52c3be880cdeafbab1), [`161da3d`](https://github.com/en-dash-consulting/n-dx/commit/161da3d04bb668f80ffe1a52c3be880cdeafbab1), [`083fa1c`](https://github.com/en-dash-consulting/n-dx/commit/083fa1c22ebdf7d86de03ecc7c59f437ae9d1bab), [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50), [`0bca3ea`](https://github.com/en-dash-consulting/n-dx/commit/0bca3ea0f0336ec4f317504fb518320c6ac6856d), [`03590e4`](https://github.com/en-dash-consulting/n-dx/commit/03590e4fa8069232774dce4e1d0fe460b969e530), [`66705e6`](https://github.com/en-dash-consulting/n-dx/commit/66705e69a1d66651644ef9a5f5ff684669ebf2e9), [`d6a6c0c`](https://github.com/en-dash-consulting/n-dx/commit/d6a6c0c0d0f01674e58b8eddd9855909787b01fa), [`ccad056`](https://github.com/en-dash-consulting/n-dx/commit/ccad05698ce562b0ae47b283a59854b299884f5c), [`cceceb5`](https://github.com/en-dash-consulting/n-dx/commit/cceceb563ba1650f4e70b9cbe63eec9bbd954e4d)]:
  - @n-dx/rex@0.8.0
  - @n-dx/sourcevision@0.8.0
  - @n-dx/llm-client@0.8.0

## 0.7.2

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.7.2
  - @n-dx/rex@0.7.2
  - @n-dx/sourcevision@0.7.2

## 0.7.1

### Patch Changes

- [#410](https://github.com/en-dash-consulting/n-dx/pull/410) [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4) Thanks [@dnaniel](https://github.com/dnaniel)! - The dashboard's Architecture, Problems and Suggestions views now unlock after a cascade analysis. They were gated on generative passes 2–4, which a cascade run never performs even though its single judged pass already produces all of those findings, so they stayed locked however often the project was re-scanned. `zones.json` now records `enrichmentMode`. For files written before that field existed, the dashboard falls back to the manifest's last run mode.

- [#393](https://github.com/en-dash-consulting/n-dx/pull/393) [`0415d3e`](https://github.com/en-dash-consulting/n-dx/commit/0415d3e2232787f9277de56c0e25e2c1b9959df6) Thanks [@endash-shal](https://github.com/endash-shal)! - A claim takeover in a linked worktree now reaches the Sessions tray when the run file is saved, not on the next poll.
  
  `GET /api/worktrees` now watches every non-served worktree's `.hench/runs/` itself — previously only the Runs view registered those watchers, so with the tray open and the Runs view never visited, a takeover waited up to 15s. A runs-directory change also drops the worktrees answer cache, so the tray's refetch is not served a pre-change answer. On the hench side, a takeover observed before the run loop attached its listener is now stamped on the run too.

- [#393](https://github.com/en-dash-consulting/n-dx/pull/393) [`0415d3e`](https://github.com/en-dash-consulting/n-dx/commit/0415d3e2232787f9277de56c0e25e2c1b9959df6) Thanks [@endash-shal](https://github.com/endash-shal)! - A run whose task another worktree takes over mid-run now says so in the dashboard's Sessions tray.
  
  Since claims began being renewed for the length of a run, a refused renewal meant the task quietly left the run's held set: the run carried on by design, and nothing anywhere recorded that the task was no longer its to finish. The renewal now emits the takeover, the run loop stamps it on the run record as an additive `claimLost` entry and saves immediately, and the Sessions tray renders "claim taken over by <worktree>" beside that run. Run records written without the field load unchanged.

- [#394](https://github.com/en-dash-consulting/n-dx/pull/394) [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard prices token usage per model and shows the split. Its aggregation now carries a `byModel` split (from hench turn records, the rex execution log, sourcevision, and the dashboard's own Ask ledger) and prices it through rex's `estimateCostFromTotals` — imported via the rex gateway, so there is one copy of the pricing arithmetic and both surfaces quote the same figure for the same runs. The Token Usage view gains a Cost by Model table (input/output/cache write/cache read/cost per model, with unknown ids labelled "priced as claude-sonnet-5" and an unattributed line for model-less tokens) and drops its hardcoded per-million rate labels. Also fixes `ndx usage`'s headline undercount: the package rollup now counts `smart_add_token_usage` events, which its own By-command breakdown (and the dashboard) already included.

- [#403](https://github.com/en-dash-consulting/n-dx/pull/403) [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add a dashboard glossary and render definition lines for terms an outside
  first-use review could not explain.
  
  An outside first-use review could not tell what "zone", "zone pin",
  "enrichment pass", "archetype", "guard rail", "epic / feature / task" or
  "worktree anchor" meant, because the dashboard showed those terms with no
  explanation.
  
  - `packages/web/src/viewer/components/glossary-terms.ts` is the single source
    of truth: one plain-language sentence per term. `GlossaryLine` (a new
    viewer component) renders it where each term first appears.
  - Wired at: Files (`archetype`, the Archetype column), Zones (`zone`, under
    the page's stat line), the zone detail slideout (`zone pin`, only when the
    zone has a pinned file, so the definition sits beside the "pinned" badge
    it explains), enrichment-gated views (`enrichment pass`, under the
    "Requires enrichment pass N" gate), the PRD tree (`epic / feature / task`,
    under the Tasks header), Workspaces (`worktree anchor`, under the page
    subtitle), and hench Config's Guard Rails category (`guard rail`).
  - The Files table reads the archetype definition to screen readers once, as
    the table's description (`aria-describedby`); the copy shown in the column
    header is marked decorative, so it is not repeated for every cell.
  - "weight" is not in the glossary: the dashboard never shows the word (the
    Zones view shows call counts), and CONTEXT.md's "weighted avg cohesion"
    means weighted by file count, a different thing.
  - Tests: every glossary term is wired to a view, and render tests check the
    conditional placements (guard rail, zone pin) and the Files table's
    accessibility markup.
  
  No route, view id, config key, or `--format=json` output changed, and no
  gateway export was added. The web boundary check's two-consumer rule for
  `src/shared/` now counts a zone only when it imports that module's own
  symbols; before, any import of the shared barrel counted for every module,
  so the rule could not fail.

- [#391](https://github.com/en-dash-consulting/n-dx/pull/391) [`bb4f829`](https://github.com/en-dash-consulting/n-dx/commit/bb4f829b0d676024fce715ee5da4db0ed2a429b5) Thanks [@endash-shal](https://github.com/endash-shal)! - An invalid `.hench/config.json` no longer bricks `ndx work`, and the dashboard can no longer write one.
  
  - hench's schema now fills a partial `retry` group with per-field defaults (sourced from `DEFAULT_RETRY_CONFIG`), so a config carrying only `retry.maxRetries` loads instead of failing with `NDX_CLI_INVALID_CONFIGURATION`.
  - `hench run` loads config leniently: an invalid top-level setting is replaced with its default and reported as a warning naming it, instead of refusing the whole run. Salvage works per top-level key, so one bad field inside a group (say `retry.maxDelayMs`) resets that whole group (`retry`). A file that is not valid JSON still fails as before; a document that fails validation and cannot be salvaged (a non-object document, for example) now names the offending fields instead of a generic "corrupted" message.
  - Every dashboard write path (`PUT /api/hench/config`, adaptive apply/override, workflow suggestion apply, template apply) completes a partially-written nested group from `CONFIG_GROUP_DEFAULTS` before serializing, so a single `retry.*` edit can never leave a one-member group on disk. The mirror between web's group defaults and hench's config defaults is pinned by `tests/e2e/hench-config-gate-contract.test.js`.

- [#405](https://github.com/en-dash-consulting/n-dx/pull/405) [`9369d40`](https://github.com/en-dash-consulting/n-dx/commit/9369d409ceec8e9fe3834adb5614a086cb2e6c23) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard tells a held claim from a live run
  
  A claim kept by a finished run (uncommitted work left in its worktree) looked
  identical to a run in progress: `GET /api/rex/claims` omitted the hold
  reason, the PRD tree chip said `claimed · <worktree>`, and Execute's 409 said
  the task "is being worked on" — sending the operator to look for a process
  that ended hours ago. Claims entries now carry `reason` when (and only when)
  a claim is held; the chip reads `held · <worktree>` with a tooltip naming the
  uncommitted work and `ndx claim release <id>`; and the Execute 409 for a held
  task explains the hold and how to free it. A live claim keeps today's wording
  everywhere.

- [#410](https://github.com/en-dash-consulting/n-dx/pull/410) [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4) Thanks [@dnaniel](https://github.com/dnaniel)! - Product logos, the per-view favicon and the notification icon load again when the dashboard is served through the hub at `/p/<id>/`. The dashboard's Isometric Map now behaves like the `sv iso` output: "Open on its own" and the breadcrumb switch scenes in place (they were dead inside the dashboard's sandboxed frame), and the map regenerates when a new analysis or background narration lands.

- [#378](https://github.com/en-dash-consulting/n-dx/pull/378) [`daef846`](https://github.com/en-dash-consulting/n-dx/commit/daef846d95ffbbd0ca3517e88139d1493dccf4f0) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix project-settings validation of `sourcevision.zones.mergeThreshold`: the dashboard capped it to 0–1 as if it were a Louvain modularity ratio, but it is the small-zone merge threshold — a minimum zone size in files, default 3. The server route and settings view now accept any non-negative integer, and the field's description, placeholder, and default hint describe the real semantics.

- [#405](https://github.com/en-dash-consulting/n-dx/pull/405) [`9369d40`](https://github.com/en-dash-consulting/n-dx/commit/9369d409ceec8e9fe3834adb5614a086cb2e6c23) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard's next-task suggestion skips tasks other worktrees hold
  
  `GET /api/rex/next` and the dashboard's Up Next card (`GET /api/rex/dashboard`) suggested the
  highest-priority task without consulting the cross-worktree claims store,
  while the Execute button refuses a claimed task with 409 — so the dashboard
  could recommend exactly the task it would then refuse to start. Both reads
  now exclude foreign live claims for the request's workspace — the same set
  Execute's check consults — so the suggestion is always a task Execute will
  accept. When a higher-priority task was passed over because another worktree
  holds it, the response says which task and which worktree
  (`skipped`/`nextTaskSkipped`), and the Up Next card shows it: `"<task>" is
  claimed by <worktree> — showing the next unclaimed task`.

- [#416](https://github.com/en-dash-consulting/n-dx/pull/416) [`e70e787`](https://github.com/en-dash-consulting/n-dx/commit/e70e787b40ada9ecaf17069b7e4f11246ebb235f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Offer to migrate a non-conformant PRD tree at the gate, and stop rather than continue
  
  A tree whose slug-rule marker names another rule, or whose paths do not match the
  running rule, used to dead-end a run with a refusal and an instruction to go and
  run `rex migrate-slugs` by hand. `ndx work` and the dashboard's Execute now close
  that loop — and stop there.
  
  Stopping is the point. On a non-conformant tree `migrate-slugs` is not a no-op: it
  rewrites every path that does not match the running rule, which can be the whole
  tree. The command exists to perform that rename deliberately, in one reviewable
  commit, instead of letting the next ordinary save produce a surprise mass diff.
  Running it inside a task run and carrying on would turn it straight back into that
  surprise diff, with the rename landing in whatever commit the task makes next under
  a message about something else — the 2026-09-17 incident (a pull request merging
  1,570 re-slugged files through green CI) with the human step deleted rather than
  automated. So the migration gets its own commit, and the operator reviews it and
  starts the run again.
  
  - **CLI.** An interactive `ndx work` prints the paths the migration would rename
    and asks. Accepting spawns `rex migrate-slugs`, reports what changed, and exits
    without executing the task. Declining rethrows the refusal unchanged.
  - **Autonomous runs are never offered it.** `--auto`, `--loop`, `--epic-by-epic`,
    `--yes`, a non-terminal stdin and CI all refuse exactly as before, and the
    message now names which of those withheld the offer instead of the run silently
    behaving differently from an interactive one. `--dry-run` is never offered it
    either, even on a terminal: a dry run promises not to touch the working tree.
  - **Dashboard.** The 412 from Execute now carries `migratable`, and Start Task
    offers a "Migrate the PRD tree" button under a refusal a migration would fix.
    Accepting sends a second explicit `{ migrateSlugs: true }` request — consent is
    carried by the request rather than inferred, since the server has no session —
    which migrates and returns without starting the task.
  - **A tree on a newer rule gets no offer at all**, in either surface.
    `TreeConformanceRefusal` gained a `migratable` flag computed from the same
    direction rule `assertSlugRuleAdoptable` enforces, so a gate cannot offer a
    migration the command would refuse.
  
  The store-level write guard is unchanged and still refuses from inside the PRD
  lock, which is where it has to stay: `migrate-slugs` needs that same lock, so
  recovering there would deadlock.

- [#410](https://github.com/en-dash-consulting/n-dx/pull/410) [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4) Thanks [@dnaniel](https://github.com/dnaniel)! - A fragmented zone partition is no longer frozen. Before a previous partition is reused or used as the Louvain seed, sourcevision checks its health: one where at least 40% of zones hold two files or fewer is rebuilt from scratch, and in the borderline band Jev decides. The rebuild happens once per input fingerprint and needs no `sv reset`. Background narration no longer loses work: a new `analyze` stops a still-running narrator and queues what it had not finished. `ndx status` and the dashboard overview report pending or failed narration, and `ndx plan` waits for narration before `rex analyze`.

- [#390](https://github.com/en-dash-consulting/n-dx/pull/390) [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396) Thanks [@endash-shal](https://github.com/endash-shal)! - Price token usage at each model's own rates instead of Claude Sonnet's.
  
  **Reported costs rise on upgrade — typically by about half, and Opus-heavy
  projects by up to about two-thirds.** Dashboard and CLI cost figures go up
  because runs are now priced at each model's own rates instead of a flat
  Sonnet rate; no tokens were added and nothing runs more expensively. On this
  repo's baseline batch the same runs moved from $161.08 (flat Sonnet) to
  $247.53 (per model), a 54% rise — the old figure under-reported by about 35%.
  Budget alerts or dashboards keyed to the old under-reported figures will see
  a one-time jump.
  
  `estimateCost` took a `ModelPricing` parameter that every caller left at a
  single hardcoded Sonnet default (3/15 per MTok, cache write 3.75, cache read
  0.30). Opus (5/25) usage was therefore quoted at three-fifths of its real cost —
  on this repo's own run history, which is not all Opus, $124 quoted against a
  real $186. The `(based on Sonnet pricing)`
  label made that honest rather than silently wrong, but it left the figures
  unusable for the before/after comparisons the cost work depends on.
  
  - `@n-dx/llm-client` — `MODEL_COSTS` gains cache-write and cache-read rates,
    so the existing catalog now covers all four billed token kinds for every
    model in `TIER_MODELS` across claude, codex and google. New `model-pricing`
    module exports `resolveModelPricing` (exact id → Claude alias → Codex legacy
    remap → lower-case retry → labelled fallback) and `priceTokens`. Two known under-reporting
    caveats are documented on the table: a 1-hour cache write bills at 2x input
    rather than 1.25x, and long-context surcharges apply above 200K input on
    some models. Neither is recoverable from aggregate token counts.
  - `@n-dx/rex` — token aggregation carries a per-model split (`byModel`) drawn
    from hench per-turn records, which already recorded vendor and model, so a
    run that switched models mid-flight is priced per segment rather than at its
    run-level model. `estimateCost` prices each bucket at its own rates and
    reports a per-model breakdown; tokens with no recorded model, and any
    remainder between the buckets and the totals, form a separate `unattributed`
    line at the fallback rate. An unrecognised model id degrades to that same
    labelled fallback rather than throwing or pricing at zero. `ndx usage` now
    prints the per-model split in place of the blanket Sonnet caveat, and emits
    it in `--format=json`.
  - `@n-dx/web` — the dashboard's duplicate pricing literal is gone; it resolves
    the same fallback rates from the shared table. Its aggregation now carries
    its own per-model split and prices it through rex's arithmetic, so dashboard
    and CLI figures agree for the same runs (see the dashboard-per-model-pricing
    changeset in this release).

- [#395](https://github.com/en-dash-consulting/n-dx/pull/395) [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Preserve unknown `tree-meta.json` keys, and check a PRD tree that carries no slug-rule marker before writing it.
  
  Two changes to the same fault. A rex MCP server running a build older than the
  `slugRule` field saved the PRD and rewrote `.rex/tree-meta.json` from a type
  that had no such field, erasing the marker. No path moved and no item changed —
  the two builds shared a slug rule — but the write guard was silently disarmed
  for whoever wrote next.
  
  - **Every `tree-meta.json` write now reads the file first and carries forward
    keys it does not recognise.** This cannot repair a sidecar an older build has
    already stripped; it stops the next such loss, between this version and the
    ones after it.
  - **A tree with no marker is no longer adopted *silently*.** It is still
    adopted when every path already matches the running slug rule — the save
    records the marker and prints a one-line notice naming `rex migrate-slugs` as
    the way to verify, and `rex validate` reports the same thing as a warning
    rather than an error. What changed is that adoption is now visible, and that
    it is conditional: an unmarked tree with a path this build did not write is
    refused outright, by the store guard, `rex validate`, the `ndx work` pre-run
    gate and the dashboard's Execute gate, all saying `slug rule marker missing;
    run rex migrate-slugs`.
  
  Absence covers two states — a tree older than the guard, and one whose sidecar
  a build older than the field rewrote without the marker — and nothing on disk
  separates them. The path scan is not a perfect tiebreak either: it can only
  recognise a rule this build can reproduce, so a tree re-slugged by a *future*
  build would scan clean. That hazard is not yet reachable, because there is no
  such rule to have written one; whoever adds one moves the guard back to a
  refusal in the same commit.
  
  `rex migrate-slugs` remains the way to re-derive every path rather than trust
  the scan, and it now reports `slugRuleRecorded` in its JSON output — on an
  already-conformant tree it renames nothing, so the counts alone read as
  "nothing happened" when it was the run that recorded the marker.
  
  **Upgrading costs nothing on a conformant repository.** The marker is new in
  this release, so every existing tree arrives without one; those written by 0.5.2
  and later already follow the current rule and are adopted on their next save. A
  tree predating that carries paths from a superseded rule (0.5.1 suffixed every
  slug with `-{id6}`; the current rule first shipped in 0.5.2), and its writes are
  refused until `rex migrate-slugs` is run — `rex validate` already reported those
  paths before this release, but nothing stopped a write from re-slugging them. A new project
  is unaffected: an empty tree has nothing a marker could be wrong about, so a
  first save proceeds and records one.

- [#405](https://github.com/en-dash-consulting/n-dx/pull/405) [`9369d40`](https://github.com/en-dash-consulting/n-dx/commit/9369d409ceec8e9fe3834adb5614a086cb2e6c23) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard closes a removed worktree's run watcher
  
  The Sessions tray watches every other worktree's `.hench/runs/` so a claim
  takeover or a finishing run reaches it as a push. Nothing closed those
  watchers when a worktree was removed, so a long-running dashboard accumulated
  handles on directories that no longer existed (the OS error event covers some
  platforms, not all). The `/api/worktrees` refresh now prunes watchers whose
  worktree left `git worktree list`; a worktree that comes back re-registers
  lazily as before, and server shutdown still closes everything.

- [#384](https://github.com/en-dash-consulting/n-dx/pull/384) [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx work` and the dashboard's Execute now refuse to start against a PRD tree written under a different slug rule, instead of discovering it at the completion write.
  
  An autonomous run writes the PRD when it finishes its task, so a run started with a mismatched build does not fail — it succeeds, and carries a whole-tree re-slug into whatever branch is open under a "task completed" commit. The store's write guard refuses that write, but only after the run has claimed the task, spent its tokens and edited the code.
  
  Both surfaces now ask the question first, through rex's new `checkTreeConformance`: the CLI refuses before taking a claim or writing anything (including on `--dry-run`, so a preview cannot report that the real run would have been fine), and `POST /api/hench/execute` answers 412 with the same message, which the viewer already surfaces on the run card. Unlike the write-time guard, a tree whose marker agrees is still path-scanned, so one whose paths were disturbed is refused too. There is no override flag: the fix is `rex migrate-slugs`, or upgrading rex when the tree was written by a newer rule. An interactive `ndx work` or the dashboard can offer to run the migration for you and then stop without executing the task.

- [#403](https://github.com/en-dash-consulting/n-dx/pull/403) [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Show analysed, inventoried-only, and skipped languages with counts on the Files page.
  
  The Files table only ever showed `byLanguage`, so a project with a language sourcevision doesn't recognize (e.g. Zig) had its files silently dropped from the inventory during the code-only walk — nothing on the page said so. `analyzeInventory`'s summary now additionally records `skippedExtensions` (extension -> file count, for files the walker saw but excluded) and `analysedLanguages` (the subset of `byLanguage` whose files take part in import-graph and zone analysis). Both fields are optional and additive, so inventories written before this change still load.
  
  The Files page now renders a strip above the table stating which languages were analysed, which were inventoried only, and which extensions were skipped, each with counts — reading the new fields when present and degrading to a single neutral "Inventoried" group when they're absent.

- [#417](https://github.com/en-dash-consulting/n-dx/pull/417) [`737b396`](https://github.com/en-dash-consulting/n-dx/commit/737b39611b68c04dbfdebfb94933102483ee9417) Thanks [@ryrykeith](https://github.com/ryrykeith)! - test: make test results independent of machine load
  
  Tests and test configuration only. No production code changes, so published output is unaffected; these packages ship `dist` only.
  
  - **web:** viewer tests now commit every preact render, update and unmount inside `act()`. Previously, a render outside `act()` left preact's after-paint fallback timer pending, and if it fired after jsdom teardown it threw `ReferenceError: cancelAnimationFrame is not defined`, failing a suite whose summary said every test passed. A new setup file, `tests/setup/preact-frame-leak-guard.ts`, fails any test file that still leaves that timer pending, and names the file.
  - **web:** the watcher-based waits in the worktree integration tests now scale with `NDX_TEST_TIME_MULTIPLIER`, and their git fixtures are removed with retries.
  - **sourcevision:** every spawn in `cli-hints.test.ts` gets a load-scaled kill budget instead of a fixed 10 seconds.

- [#406](https://github.com/en-dash-consulting/n-dx/pull/406) [`8040ca0`](https://github.com/en-dash-consulting/n-dx/commit/8040ca0b8d04c21e4c8857fc95ccd5f54c327fd7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `hench.tokenBudget` counts cache writes and excludes cache reads
  
  `checkTokenBudget` summed `input + output`. With prompt caching, `input` holds
  only the uncached slice — an 83-turn API-loop run recorded 534 uncached input
  tokens against 876K cache writes and 34.1M cache reads — so a configured budget
  bounded output plus a rounding error, and the run continued to `maxTurns`
  instead of stopping.
  
  The budget now counts **uncached input + cache writes + output**, on the API
  loops and the Claude and Codex CLI paths alike, and excludes cache reads. A
  cache read is by construction a re-read of tokens already counted when they
  were written, so counting reads would charge the same tokens once per turn:
  across the 27 recorded runs in this repository, face value ran a median of
  **70x** the counted total. On the Claude CLI path, where the check runs after
  the session has finished, that would have marked every non-trivial run
  `budget_exceeded` and reset its task before the review and commit steps. The
  rule needs no price table and stays vendor-neutral, and runaway loops remain
  bounded because cache writes and output both grow with turn count.
  
  A run that writes no cache counts exactly what it did before. A Claude Code
  session always writes one, so on the CLI path every run now also counts its
  cache writes, and a budget tuned to the old accounting may need raising on
  either path.
  
  Also:
  
  - Built-in template budgets re-derived from measured runs. Counted cost is
    affine in turn count — roughly `190,000 + 5,400 x turns`, where the constant
    is the initial context write — so each budget is that fit at the template's
    `maxTurns`, doubled for headroom: quick-iteration 50K -> 600K,
    thorough-execution 200K -> 1.5M, budget-conscious 30K -> 600K,
    api-direct 150K -> 850K. The old values predated prompt caching and sat
    below a single median run. `budget-conscious` is not tightened below
    `quick-iteration` despite its name: measured runs in its turn class
    *completed* at 484K and 489K, so a lower budget would fail finished work —
    it economises through `maxTurns` and its 4096 `maxTokens` cap instead. The
    dashboard's template list carries the same values.
  - The budget-exceeded message now names the token classes that counted and how
    many cache-read tokens were excluded, so a genuine overrun can be told apart
    from cache-read inflation.

- [#390](https://github.com/en-dash-consulting/n-dx/pull/390) [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396) Thanks [@endash-shal](https://github.com/endash-shal)! - test(web): count render and traversal work in the viewer tree performance suites instead of timing it
  
  `large-tree-performance.test.ts` and `prd-tree-live-tick-perf.test.ts` held 25 of
  the repo's elapsed-time assertions, all comparing `performance.now()` against an
  absolute budget scaled by a `BUDGET_MULTIPLIER` hardcoded to `10` rather than read
  from `NDX_TEST_TIME_MULTIPLIER`. Under full-suite load, the live-tick budget of
  160ms measured 420.10ms while the same file completed in 108ms run alone. Raising
  the budgets is not available — TESTING.md forbids padding one to green a suite,
  and the next busier machine just fails at the new number.
  
  Growth-ratio timing was tried first and rejected on measurement: `diffItems` timed
  across an 8x size step read 7.7x idle and 46.5x loaded, because min-of-N filters
  a ~4ms block and a ~30ms block differently. A ratio only cancels load when both
  readings face the same preemption risk, which sub-millisecond work cannot give.
  
  Both files now count work (TESTING.md Family 2, technique 1) via a new
  `tests/helpers/tree-work-count.ts`:
  
  - `countTreeReads` instruments the fixture's `children` arrays, so a traversal's
    step count is exact. Reads per node hold to three significant figures across a
    7.97x size range and are unchanged with every core saturated; an injected O(n²)
    reads 197.8 per node against a clean 1.18, and grows 62.91x against a 15.94x
    bound.
  - `countRenderWork` counts vnodes diffed via Preact's `options.diffed` hook and
    DOM records via a `MutationObserver`. Both counters are needed: a broken
    `shouldComponentUpdate` gives 7 805 diffs / 442 mutations against a clean
    1 033 / 1, while churning row keys gives 263 / 512 — each regression is
    invisible to the other counter. Both were injected and confirmed failing.
  
  Two non-timing assertions in the same file were also failing under load. Every
  render is now unmounted: `useLiveTick` starts a real 1s `setInterval` while an
  in-progress row is visible, so each render previously left a live interval
  re-rendering a 500–2000 row tree for the rest of the file, free to interrupt a
  later test mid-measurement.
  
  The DOM-per-item assertion also stops guessing. It subtracted a hardcoded
  `overheadEstimate = 200` for the tree's chrome; the real figure, measured by
  rendering an empty document in the same process, is 9. It had been reporting 18.6
  DOM nodes per row where the true value is 21.7 — passing, but not for the reason
  it stated.
  
  Full suite verified green with a concurrent `pnpm build` and every core saturated
  (15-minute load average 24.6). No production behaviour changes.
- Updated dependencies [[`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`ee16578`](https://github.com/en-dash-consulting/n-dx/commit/ee165780ecdc34ad0349ab7028875f04bff769e0), [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1), [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`fdb8376`](https://github.com/en-dash-consulting/n-dx/commit/fdb8376fa554f7ef92c65e3819def5dbbf74e933), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`fdd864c`](https://github.com/en-dash-consulting/n-dx/commit/fdd864c4db245e5d69a0ae78534f07c0cc752c0e), [`e70e787`](https://github.com/en-dash-consulting/n-dx/commit/e70e787b40ada9ecaf17069b7e4f11246ebb235f), [`e70e787`](https://github.com/en-dash-consulting/n-dx/commit/e70e787b40ada9ecaf17069b7e4f11246ebb235f), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396), [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675), [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649), [`87c0af9`](https://github.com/en-dash-consulting/n-dx/commit/87c0af99fd7f9bdc4f563d74f323166307bb3e26), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649), [`bb4f829`](https://github.com/en-dash-consulting/n-dx/commit/bb4f829b0d676024fce715ee5da4db0ed2a429b5), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`5866f4e`](https://github.com/en-dash-consulting/n-dx/commit/5866f4eddf660fb4d254dd9a6e66e1fbc4aae7d7), [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675), [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`5866f4e`](https://github.com/en-dash-consulting/n-dx/commit/5866f4eddf660fb4d254dd9a6e66e1fbc4aae7d7), [`737b396`](https://github.com/en-dash-consulting/n-dx/commit/737b39611b68c04dbfdebfb94933102483ee9417), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4)]:
  - @n-dx/sourcevision@0.7.1
  - @n-dx/rex@0.7.1
  - @n-dx/llm-client@0.7.1

## 0.7.0

### Minor Changes

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the hub daemon skeleton (`web hub`, default port 3117): a per-user registry at `~/.n-dx/hub.json` with atomic writes, a `~/.n-dx/hub.pid` file, and `/api/hub/*` routes (`GET /health`, `GET|POST /projects`, `GET|DELETE /projects/:id`). Registering a project spawns `<ndxBin> serve --port=0 <repoRoot>`, reads the bound port from `<repoRoot>/.n-dx-web.port`, and records pid and port. Children are health-checked every 15 s via `GET /api/status`, marked unreachable when they stop answering, and respawned once. On restart the hub re-attaches to children whose recorded pid is alive and answering, and respawns the rest. `$N_DX_HOME` overrides the registry directory.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start` now registers the repository with the per-user hub by default and serves it at `http://localhost:3117/p/<id>/`; `--here` (or `web.mode: "here"`) gets the single-project server that owns the port. `ndx start stop` unregisters the worktree it runs in through the new `DELETE /api/hub/projects/:id/worktrees/:path` — the project keeps being served while another worktree is registered, and the last one unregisters the project and stops its server. A hub left with no projects exits, unless `hub.keepAlive` is set in `~/.n-dx/config.json`. `ndx start status` reports the hub (pid, port, uptime), the project (id, state, server pid and port, repository, registered worktrees) and the URL. New `ndx hub status` and `ndx hub stop` address the hub itself from any directory.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Per-project MCP endpoints through the hub: `/p/<id>/mcp/rex` and `/p/<id>/mcp/sourcevision` are proxied to that project's server with `Mcp-Session-Id`, SSE responses, the GET event stream and `DELETE` session close carried through; the root `/mcp/*` aliases the sole registered project and answers 409 with the ids when several are registered. Two registered projects have independent sessions and write to their own trees. README's HTTP registration section now uses the per-project URL and keeps the tracked `.mcp.json` as the recommended path.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Hub reverse proxy and viewer base-path support. Requests under `/p/<id>/…` are proxied to that project's server with the prefix stripped — HTTP streamed both ways, WebSocket upgrades piped through — and root-relative redirects are re-prefixed. With exactly one project registered the root (`/`, `/api/*`, `/data/*`, `/mcp/*`, the socket) aliases to it unchanged; with several, `/` lists the projects and other root requests answer 409 with their ids. The viewer derives its base path from `location.pathname` at boot, prefixes every root-relative `fetch` through one adapter, connects its sockets through one URL helper, and writes prefixed history entries, so every view and deep link works at `/p/<id>/<view>` while `web serve` at `/` is unchanged.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Per-workspace job state. The trackers that were process-wide singletons are now keyed by the workspace a request addresses (`src/server/workspace-scoped.ts`): the sv-analyze, refresh, self-heal, init, ci and reshape statuses and the `.sourcevision` writer lock in routes-commands; the epic-by-epic execution state and its hench process in routes-rex/execution; the active executions, execution metrics and process-memory tracker in routes-hench; and the status, project-metadata and config caches. Starting an analysis in worktree A no longer blocks or reports in worktree B; shutdown, emergency stop without a context, and the memory monitor sweep every workspace. A single-workspace server behaves exactly as before.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub now admits dashboard-started agent runs against machine-wide limits instead of letting every project start its own. A run is forwarded when fewer than `hub.maxSessions` are in flight across all registered projects and free memory is above `hub.memoryFloorBytes`; otherwise it is queued FIFO and answered `202 { queued: true, position }` rather than refused, and released when capacity frees. `~/.n-dx/config.json` gains `hub.maxSessions` (default 4) and `hub.memoryFloorBytes` (default 2 GiB), with every unusable key named once at hub start and falling back to its default rather than stopping the hub. `GET /api/hub/queue` reports the limits, what is running, what is waiting, and whether admission is paused for low memory.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub root now serves a home page with one card per registered project instead of a bare list. Each card joins the registry onto that project's own server — branch, uncommitted files, agents running, PRD progress and the next task — through the new `GET /api/hub/overview`, which the page also re-reads every few seconds so a card that changes while you are looking at it updates without a reload. A project whose server is not answering still gets a card saying so. Cards carry a "Start working" link into that project's Runs view rather than a second execute route, follow the dashboard's own theme (same storage key, so the choice carries between them), and are reachable from the keyboard.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Workspace registry: the server is anchored at the directory it was started in and holds one `ServerContext`, watcher set and PRD cache per worktree of the repository (`src/server/workspaces.ts`). The anchor is set up eagerly exactly as before; any other worktree is created lazily the first time a request addresses it — via the `X-Ndx-Workspace` header or the `/w/<key>/` slot — and falls back to the anchor otherwise, so nothing observable changes for a single-worktree server. Keys are worktree basenames (`main` aliases the anchor); the list refreshes from `git worktree list` every 30 s and on `POST /api/workspaces/refresh`, releasing the resources of a worktree that disappeared (never the anchor). `GET /api/workspaces` lists them.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Workspace-tagged WebSocket frames and the breadcrumb workspace switcher. Every broadcast now carries `{ workspace: <key> }` — watchers and routes stamp the workspace they act on, process-wide monitors stamp `"*"` — and the viewer drops frames for another workspace (untagged frames read as the anchor's), so a change in one worktree no longer makes a tab on another refetch. The breadcrumb's branch chip is now a keyboard-accessible listbox of every worktree with the anchor starred, a pulse for running work, elapsed time since the last run and the dirty-file count; choosing one opens the same view under `/w/<key>/`, and a footer links to the Workspaces overview.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `/w/<key>/` URL slot for worktrees. The viewer's base path now carries the workspace slot alongside the hub's `/p/<id>` prefix, so `/w/feature/prd` (or `/p/app/w/feature/prd`) deep-links to that worktree's tree and every fetch, socket and history entry the viewer builds keeps the slot. The project server strips the slot before dispatch and resolves the workspace in the registry, accepts `X-Ndx-Workspace` for non-browser clients, answers an unknown key with a 404 page linking to the anchor, and serves slot-less paths from the anchor exactly as before.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the Workspaces Overview view: a new WORKSPACES sidebar section (above SOURCEVISION, one item "Overview") opening a board of one card per git worktree of the served repository, under a machine strip of four stat tiles — agents running, memory in use, uncommitted trees, and PRD items that exist only on branches.
  
  Each card carries the worktree's branch, its live hench run (task title linking into *that* worktree's PRD, elapsed time, tok/s and last output line) or when it last ran, an uncommitted-files or clean chip, a PRD-delta chip versus the anchor, and the actions Open workspace, Start working and Stop. The board addresses each worktree with the `X-Ndx-Workspace` header, and — uniquely among socket consumers — keeps frames about other workspaces rather than filtering them out, so a run progressing in one worktree moves its card while you are looking at another.
  
  `StartTaskButton` gains optional `workspace` and `ariaLabel` props; with `workspace` set the run starts in that worktree (cwd = worktree). Sidebar sections that end up with no visible items are no longer rendered as an empty header.

### Patch Changes

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Allowlist the config keys the adaptive routes may write.
  
  `POST /api/hench/adaptive/override` and `/api/hench/adaptive/apply` read a
  caller-supplied `key`/`configKey` and wrote it straight into `.hench/config.json`
  via an unguarded `setNestedValue` — no allowlist, no value check, no protection
  against a `__proto__` segment. A same-origin caller could set an invented key or
  mistype a real one, and the next autonomous hench run would inherit it. This is
  the sibling of the workflow-apply hole closed earlier.
  
  The config-field allowlist (`CONFIG_FIELD_META`), its value validation, and the
  nested get/set helpers now live in one shared module,
  `hench-config-fields.ts`, imported by both `routes-hench.ts` (the config editor,
  already allowlisted — the reference pattern) and `routes-adaptive.ts`, so the
  three config-write paths cannot drift. Both adaptive routes now reject (400)
  before writing when the key is not an allowlisted field, contains a
  prototype-poisoning segment, or carries a wrong-typed value; `setConfigValue`
  drops forbidden segments as defense in depth.
  
  Found by the 2026-09-11 adversarial security review follow-up (task 0a778581).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Write API keys to `.n-dx.local.json`, never to the shared `.n-dx.json`.
  
  `ndx config claude.api_key` (and `llm.claude/codex/google.api_key`) wrote the
  key into `.n-dx.json` — the file that carries zone pins, the vendor and the
  dashboard port, that the gitignore template calls safe to commit, and that
  `ndx init` never gitignores. Only `*.cli_path` was routed to the gitignored
  `.n-dx.local.json`; the help text itself said "stored in .n-dx.json — add to
  .gitignore". One `git add -A` put the key on the remote. The 0600 chmod on the
  file defends against other local users, not against git.
  
  `*.api_key` now joins `*.cli_path` in the local-only set. Every reader already
  merged the local layer over the shared one (core `config.js`, `@n-dx/llm-client`
  `loadClaudeConfig`/`loadLLMConfig`), so resolution is unchanged; the dashboard's
  `/api/ndx-config` auth-method detection was the one reader that looked at
  `.n-dx.json` alone and now merges too, so the footer keeps its ✓.
  
  For projects configured before this: every `ndx config` run warns on stderr
  when `.n-dx.json` holds an `api_key`, naming the key and the fix. Re-setting the
  key is the migration — it lands in the local file and the shared copy (and the
  legacy `claude.*` mirror of an `llm.claude.*` key) is removed. `ndx ci` gains a
  `config-secrets` step that fails when a git-tracked `.n-dx.json` contains an
  `api_key` and warns when an untracked one does.
  
  Found by the 2026-09-11 adversarial security review (finding A).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `GET /api/worktrees`: every git worktree of the served repository with branch, HEAD, anchor/served flags, dirty state, a summary of the hench runs recorded under it, and whether an `ndx start` server is present (pid/port marker files). Best-effort per worktree, cached for 5 s, `[]` outside a repository.
  
  Retire the half-built sibling-directory project scan (`GET /api/projects`, `detectProjects`): nothing in the viewer consumed it, and cross-project switching is the 0.7.0 hub registry's job.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix eight defects found reviewing this branch: the hub's API now checks the
  browser origin before registering a project (registration spawns a process);
  the hub restates the forwarded `Origin` so dashboard mutations and WebSocket
  upgrades work through the proxy in hub mode; the anchor's frames go out
  untagged so the single-worktree dashboard updates live again;
  `X-Ndx-Workspace` outranks the `/w/<key>/` slot, so the Workspaces board acts
  on the worktree it names; `ndx start --here` relocates rather than SIGKILLing
  the hub; the rex MCP path writes task claims (`claim_task`, `release_task`, and
  on `in_progress`) instead of only reading them; workflow-template config
  overlays go through the same allowlist as every other config writer; and a
  malformed percent-escape in a URL no longer ends either server.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix cross-worktree task claims under the dashboard and hub MCP endpoints. A
  claim's owner is now its worktree alone; the pid is only a liveness check.
  `ndx start` runs one rex MCP server per workspace inside a single process, so
  every worktree's claim carried that one pid — and an ownership test that
  accepted a matching pid let two worktrees hold the same task, let either
  release the other's claim, and silenced the dashboard's own "another worktree
  is working on this" refusal. `ClaimsStore.release` and `isClaimedByOther` now
  take the asking worktree rather than a pid.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Task selection is claim-aware across worktrees. `hench run` (what `ndx work` spawns) claims the task it selects — before the brief and any LLM turn — and releases it when the run ends (completed, failed, cancelled by Ctrl-C, or thrown); an explicit `--task` another worktree holds is refused with the holder's worktree, and a retry in the worktree that already holds a task takes the claim over. `rex next`, the `get_next_task` MCP tool and hench's autoselection pass over tasks other worktrees hold (`skippedClaimed` in JSON output, one line per task under `--verbose`), and `findNextTask` / `findActionableTasks` accept `excludeIds`. The dashboard's execute route answers 409 with `claimedBy` when another worktree holds the task. Outside a git repository nothing changes.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The static run detail now says why a failed run has no error text.
  
  `ndx export` strips `error` from both the per-run file and the `runs.json`
  index unless `--include-transcripts` is passed — an error body can echo
  whatever the agent read. The run detail rendered the Error section only when
  `run.error` was present, so an exported failed run showed a "Failed" badge and
  nothing else, indistinguishable from a run that failed for no recorded reason.
  
  `runErrorDisplay` now decides that section's contents: the failure body when the
  record carries one, otherwise a neutral notice for a failed run stamped
  `transcriptOmitted`, naming the flag that would have published the text. The
  Task Audit log viewer already did this for tool calls; the runs view now
  matches.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx export` no longer publishes agent transcripts by default, and `--deploy=github` confirms before pushing.
  
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

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the dashboard's hench-config gate accepting values hench's schema rejects.
  
  `validateFieldValue` (`hench-config-fields.ts`) is the single gate for the three
  routes that write `.hench/config.json` — `PUT /api/hench/config`,
  `POST /api/hench/adaptive/apply`, and `POST /api/hench/adaptive/override` — but
  it was looser than hench's `HenchConfigSchema` in three ways. Enum fields were
  checked via `String(value)`, so `provider: ["cli"]` coerced to `"cli"` and an
  array was written where `z.enum` expects a string. Array fields were checked with
  `Array.isArray` alone, so `guard.allowedCommands: [1, null]` passed a
  `z.array(z.string())` field. Number fields rejected only negatives and `NaN`, so
  `0` was written to `guard.commandTimeout` (`z.number().positive()`) and JSON
  `1e999` was accepted as `Infinity`, which `JSON.stringify` then wrote as `null`.
  Each case returned 200 and produced a config hench refuses to load, so the next
  `ndx work` would not start until the file was hand-edited.
  
  The gate now requires a string before an enum lookup, requires every array
  element to be a string, requires `Number.isFinite`, and honours two new
  `ConfigFieldInfo` flags — `positive` and `integer` — that mirror the `.positive()`
  and `.int()` refinements on the matching hench field. A new cross-package
  contract test (`tests/e2e/hench-config-gate-contract.test.js`) probes every
  writable field against both definitions and fails if the gate ever accepts
  something `HenchConfigSchema` rejects, so the two cannot drift again silently.
  
  Found by the 2026-09-15 adversarial review (task 0a85aec1).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Hench Runs view aggregates runs across worktrees. `GET /api/hench/runs` (and `/runs/:id`) accept `?scope=repo`, merging every worktree's `.hench/runs/` and tagging each run with `{ name, path, branch }`; the default scope is unchanged. A lazily registered `fs.watch` per other-worktree runs directory keeps `hench:run-changed` firing for runs written elsewhere. The viewer requests repo scope, shows a mono worktree chip on each card when runs span more than one worktree, and adds a worktree filter.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start --hub` now writes `.n-dx-web.port` (the hub's port) and `.n-dx-web.pid` (`{ pid, port, startedAt, via: "hub", projectId }`) in the started directory, so `ndx refresh --live-server` keeps working unchanged: its reload signal reaches the hub, which forwards it to the project's own server. The reload body now carries `dir`; with several projects registered the hub matches it against each project's repository root and worktrees (deepest match wins), answering 409 without a directory and 404 for an unregistered one. `ndx start stop`, `ndx start status` and refresh's pre-flight recognise the hub marker and never stop the hub through it; `ndx start --here` over a marker takes the files over instead of killing the hub.

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the local (LM Studio) per-request timeout configurable via `llm.local.timeoutMs`
  
  Local completions were bounded by a hardcoded 5-minute abort in three places — the
  local API provider, hench's local tool loop, and the second-model verifier (60 s) —
  so a slow local model failed with `NDX_CLI_TIMEOUT` no matter what the CLI-timeout
  settings said. `cli.timeoutMs` / the "CLI Timeouts" page bound a whole command, not
  an individual HTTP request, so setting them to unlimited had no effect on this path.
  
  All three now read `llm.local.timeoutMs` (default 300000, `0` = no timeout), settable
  via `ndx config llm.local.timeoutMs <ms>` or the LLM Provider settings page. The
  timeout error message now names the key to change.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `ndx which [dir]` — report which copy of n-dx is actually running.
  
  The package version is the same string in every checkout and every install, so `ndx --version` cannot distinguish a globally installed `ndx` from the worktree you are standing in. `ndx which` prints five fields instead: the version, the absolute path of the `cli.js` executing, the install kind (npm registry install, pnpm global link, or workspace checkout), the branch and short SHA of the install checkout when it is a git working tree, and the resolved project directory. `--json` emits the same record as one object, and `ndx --version --verbose` prints the identical report.
  
  Install kind distinguishes a globally linked checkout from one invoked directly by comparing `process.argv[1]` against the realpathed entry point — Node leaves the former as the symlink, so a global bin shim makes the two disagree. The command always exits 0: a missing `git`, or an install that is not a working tree, reports no git identity rather than failing.
  
  `which` is registered in `ndx --help`, has its own `ndx which --help` page, and appears in the dashboard's All Commands view under Setup — ungated, since identifying the CLI is most useful on a project that is not initialized yet.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Cap request body size on the dashboard server.
  
  `readBody` concatenated every chunk with no limit, so a local process (the
  server is loopback-only) could POST a multi-gigabyte body to any route and
  drive it out of memory before the handler ran.
  
  A new `MAX_REQUEST_BODY_BYTES` (10 MB — the largest legitimate body is a PRD
  bundle import) is enforced in two places: `handleRequestSecurity`, which runs
  first for every request, answers `413` and destroys the connection when the
  declared `Content-Length` exceeds the cap (before any buffering); and
  `readBody`, which stops buffering, destroys the request, and rejects if a
  chunked body with no declared length streams past the cap. `jsonResponse` is
  now a no-op once the response is committed, so a route that already answered
  cannot double-write.
  
  Found by the 2026-09-11 adversarial security review (finding H).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the Sessions tray: a third bottom-right pill — "3 worktrees · 1 running" — expanding into a row per worktree with its name (anchor starred), branch, dirty count, and either the run in flight with a ticking elapsed time or the last one with its status, linking through to that run in the Runs view. Read-only: it does not switch the dashboard's workspace. Hidden outside a git repository and in a single-worktree one.
  
  `GET /api/worktrees` gains `runs.latest` — the running run that started most recently, else the most recently finished one — with the id, status, task title and timestamps the tray shows.
  
  Move `formatSince` from the Workspaces view to `viewer/utils/format.ts`, now that the tray is its second consumer.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard shows cross-worktree task claims. New read-only `GET /api/rex/claims` lists the live claims in the repository's shared store, with each task's title from the served PRD and the claiming worktree. PRD tree rows carry a "claimed · <worktree>" chip ("here" when this checkout holds it), and the Sessions tray lists the tasks each worktree has claimed under its row. Both refresh on the poll tick and on `hench:run-changed`, so a claim appears within one interval and disappears when released.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The sidebar footer now shows which n-dx is running: `n-dx <version> · <install> · <project>`, with the full CLI and project paths in its tooltip. It reads the `server` object that `GET /api/config` already returns and that the viewer already fetches before its first render, so there is no extra request, and it renders on every view without waiting for the configuration panel's own fetch. A server too old to send the object renders no identity line.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - A dashboard can now see the hub's admission queue. `GET /api/hub/queue` is answered under a project prefix too (`/p/<id>/api/hub/queue`), which is the only address a viewer has — its fetches are rewritten to sit under the page's base path, so the hub's own API was previously unreachable from the page the hub serves. Asked that way, the queued entries are scoped to that project while the running count, limits and memory state stay machine-wide, since waiting behind another project's run is exactly what needs explaining. A new `useHubQueue` hook polls it, tolerating the single-project server where no hub answers.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - An over-cap chunked request body now gets an HTTP 413 instead of a reset connection. `readBody` used to destroy the request the moment the streamed cap was passed and leave the answering to the caller's `catch` — which could not work, because destroying the request destroys the socket, so the 400 was written into a closed connection and the client received zero bytes and an EPIPE. It now sends the same 413 the Content-Length guard sends, closes cleanly, and still rejects so callers keep their existing `catch` (which no-ops once the response is committed). Only clients that send chunked bodies without a Content-Length were affected; the dashboard always sends one.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `GET /api/workspaces/:key/prd-delta`: how a worktree's PRD differs from the anchor's, computed server-side by item id — `onlyHere`, `onlyAnchor`, `changed` (status, title, priority, description or lastModified differ) and `completedHere` — with exact counts, id lists capped at 500 (`truncated` flag), and `identical` for trees that match. Cached per (anchor, workspace) pair and invalidated by either tree's rex watcher.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Reject cross-origin WebSocket upgrades on the dashboard server.
  
  A WebSocket handshake carries no CORS preflight, so the HTTP-side
  `handleRequestSecurity` guard never saw it — the `upgrade` handler checked only
  for a `Sec-WebSocket-Key`. While `ndx start` ran, any page open in the user's
  browser could `new WebSocket("ws://localhost:<port>")` and receive every
  broadcast: PRD changes, `hench:task-execution-progress` (which carries the
  agent's last stdout line), execution and memory state. Inbound frames are
  limited to close/ping/pong, so this was a passive read, but the only
  cross-origin hole in an otherwise well-guarded server.
  
  `handleUpgrade` now applies the same origin check the HTTP guard uses
  (`isTrustedBrowserOrigin`, exported for this): a present `Origin` must be this
  loopback server's own (compared against the socket's local port, so a
  DNS-rebinding Host cannot match), or the upgrade is answered `403 Forbidden`
  and the socket destroyed before any client is registered. A missing `Origin`
  (non-browser CLI/MCP clients) stays allowed, matching the HTTP guard's contract.
  
  Found by the 2026-09-11 adversarial security review (finding E).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Allowlist the config keys `POST /api/hench/workflow/apply` may write.
  
  The endpoint applies machine-generated workflow suggestions, but
  `handleApplySuggestion` wrote whatever keys the request named into
  `.hench/config.json` with no allowlist and no value check. A same-origin caller
  could set `guard.allowedCommands`, `guard.blockedPaths: []`, or
  `permissionMode: "bypassPermissions"` — and the next hench run would inherit
  them (arbitrary commands, no path sandbox, permissions bypassed) — or use a
  `__proto__` path segment to poison the prototype chain.
  
  `apply` now validates `changes` against `APPLYABLE_SUGGESTION_KEYS` — the exact
  set the suggestion generator emits (`tokenBudget`, `maxTurns`,
  `retry.maxRetries`), each required to be a nonnegative integer — before preview
  or any write, so a rejected request (400) leaves the config file untouched. Path
  segments `__proto__`/`constructor`/`prototype` are refused, and the module's
  `setNestedValue` drops them as defense in depth. A test pins the allowlist to
  the keys the generator actually emits so the two cannot drift.
  
  Found by the 2026-09-11 adversarial security review (finding F).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Build lazily-created workspace contexts' `svDir`/`rexDir` with `path.join` instead of `/` string concatenation, so non-anchor worktree paths use native separators on Windows (the PRD lock and store resolution key off `rexDir`, where a mixed-separator spelling risks cache and lock misses).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the dashboard's workspace-scoped PRD writes explicit. The PRD view now shows a one-line strip naming the workspace whenever it is not the anchor ("Workspace <name> · writes go to this worktree's PRD"), so an edit made while viewing a branch worktree states its target rather than leaving it to be inferred from the URL. There is still no cross-workspace write action — switching to the anchor's PRD is a workspace switch. Adds an integration test that hashes both worktrees' trees around a write through `/w/<key>/api/rex/items` and a slot-less write, pinning that each lands in exactly one tree.
- Updated dependencies [[`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d)]:
  - @n-dx/rex@0.7.0
  - @n-dx/llm-client@0.7.0
  - @n-dx/sourcevision@0.7.0

## 0.6.0

### Patch Changes

- [#366](https://github.com/en-dash-consulting/n-dx/pull/366) [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Spawn the vendor CLI (Claude CLI provider) with `cwd` set to the caller's project directory instead of inheriting the server process's own cwd.
  
  `createLLMClient`/`createClient` now accept an optional `cwd`, threaded through to `cli-provider.ts`'s `spawnCli` call. The dashboard's Ask route (`routes-sourcevision-ask.ts`) passes `ctx.projectDir`, so an Ask request run against a different project no longer executes the CLI wherever `ndx start` happened to be launched from. Hench's own spawn path already passed `cwd` and is unchanged.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Enforce `sourcevision.ask` on the endpoint, not just in the viewer.
  
  `POST /api/sourcevision/ask` now refuses with `403` and `kind: "disabled"` when
  the toggle is off. Gating only the viewer made the toggle a property of one
  client: the panel hid itself while anything else that could reach the port
  still spent the project's tokens, which is the one consequence the toggle's
  impact text names.
  
  - **Checked before the body is read and before the analysis is loaded**, so a
    disabled project is told the feature is off rather than told about whichever
    other precondition it also happens to be missing.
  - **Fails closed.** A missing `.n-dx.json`, an unparseable one, or a key absent
    from the registry all resolve to the registry default — `false` for Ask. A
    gate that opens when it cannot tell is not a gate.
  - **Read per request, not cached.** Toggles are edited from the dashboard while
    the server runs; a value read once at startup would keep refusing after the
    user enabled it.
  
  New `isFeatureEnabled(projectDir, key)` in `routes-features.ts` is the shared
  reader. `disabled` is a first-class `AskErrorKind` with its own status, fallback
  wording, and entry in the panel's per-kind presentation table, so the card names
  the fault and points at the Feature Toggles view instead of rendering a bare
  403. `askFailureKindFromStatus` deliberately does not mirror 403 back to
  `disabled`: our own 403 carries its kind in the body, and a foreign 403 is an
  access denial.
  
  This diverges from `sourcevision.prMarkdown`, which stays viewer-gated. The
  difference is deliberate — that page renders from analysis already on disk,
  while each Ask call spends tokens. The two `/api/rex/*` routes the panel uses
  (`capture-ask`, `apply-refinements`) are not gated: they belong to the rex
  scope and neither one calls a model.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Attribute SourceVision Ask token spend in the LLM Utilization view
  
  Every Ask call spent real tokens from a surface with no accounting path. Hench
  runs land in `.hench/runs/` and roll up per PRD item; rex and sourcevision
  report through their own artifacts. The dashboard's own spend reported nowhere,
  so the one view whose job is to report the bill was blind to its own.
  
  Each call is now appended to `.n-dx-web-usage.jsonl` with vendor, model, input,
  output, cache-creation and cache-read tokens, plus how the call ended. The
  utilization aggregation reads it as a fourth package bucket, `web`, rendered as
  "Dashboard" — its own colour, donut slice, filter option and command row, so it
  stays separable from hench run spend everywhere the view breaks down by
  package. Asks are not task-scoped, so the spend is a dashboard bucket rather
  than being attributed to whichever PRD item happened to be selected.
  
  Failed calls are recorded too, with the call counted and whatever the provider
  reported. A provider that finishes after the ask timed out appends its counts
  as a second, call-free record, so late tokens are neither lost nor
  double-counted as a second call. A call that never reached a provider (no
  analysis, unconstructible client) is deliberately not recorded — the ledger
  counts calls, not intentions.
  
  Cache tokens are now reported in this view rather than hidden, consistent with
  the hench/rex decision. The server had always counted and priced them
  (`estimateCost` charges cache writes at 1.25x input and reads at 0.1x), but the
  viewer's local copy of the wire shape omitted the fields and totalled only
  input + output — so "Total Tokens" disagreed with the "Est. Cost" beside it, and
  on a cache-heavy run most of the bill had no visible line. Cache write/read now
  appear as headline figures, as columns in the vendor-model and command tables,
  and as their own cost lines.
  
  The aggregation cache also fingerprints the ledger, so an answer's cost appears
  without waiting for an unrelated source to change.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Gate the Explain action on the `sourcevision.ask` toggle.
  
  `sourcevision.ask` is experimental and defaults to off, and its impact text says
  each question spends tokens. The tab list and the sidebar both honoured it; the
  **Explain** button on Problems and Suggestions rows did not. On a default
  install that left Ask fully reachable — finding row → Explain → panel → submit →
  tokens — through the one entry point that is not in the sidebar, while the only
  control that could turn it off is hidden by the very toggle that is off.
  
  Both views now take the toggle as a prop and omit the action when it is false,
  on the same branch that already omitted it when the surface has nowhere to
  navigate. The prop defaults to `false`, so a call site that forgets it renders
  no button rather than an ungated one.
  
  The toggle is read in `main.ts` rather than in the views: the view-registry
  renderers are plain functions dispatched by view id, so a hook called inside one
  would be a conditional hook in `App`, and Problems and Suggestions both return
  early from an enrichment gate before their own hooks run.
  
  Tests cover the button's absence in both views with the toggle off and with the
  prop omitted, plus the registry wiring that supplies it — dropping the prop
  there would have restored the old behaviour with every component-level
  assertion still passing.
  
  The endpoint enforces the same toggle — see the separate changeset for
  `POST /api/sourcevision/ask`.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Call every hook before the enrichment gate in all three gated SourceVision views.
  
  Architecture, Problems and Suggestions each return an `EnrichmentGate` early when
  the analysis has not reached their threshold, and then called `useMemo` below it.
  `enrichmentPass` is loaded data — 0 on the first render, real once the data
  arrives, and different again when an analysis finishes with the dashboard open —
  so the early return is taken on some renders of the same mounted component and
  not others, and every hook below it was conditional. Preact matches hooks by
  position and, unlike React, does not warn: the slots simply shift.
  
  All three now call their hooks first and gate afterwards. In Problems and
  Suggestions `findings` is memoized on the source array while moving, which also
  makes the memo that keys on it work at all — a fresh array each render meant it
  recomputed every time. Architecture needed only the one memo hoisted; nothing
  there keys on `findings`, so it stays a plain filter below the gate.
  
  The invariant is pinned structurally, by asserting no view calls a hook after its
  early return. A behavioural test cannot fail on this defect: the conditional
  hooks were appended after the stable ones, so nothing is misread today and the
  exposure is to the next edit. Transition tests cover the other half — crossing
  the threshold in both directions, repeatedly, renders what it did before.
  
  The guard's view list is itself checked against the directory, so a view that
  renders an `EnrichmentGate` cannot be added without being covered. That gap is
  why Architecture was missed the first time: the list was hardcoded to two
  entries while the suite claimed to check every gated view.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Guard the `NDX_CLI_PATH` rung of the ndx binary ladder, and document it.
  
  `resolveNdxBin` had an undocumented first rung — `NDX_CLI_PATH` returned
  verbatim, above every rung its doc comment described, and without the
  `existsSync` check its twin `N_DX_CLI_PATH` has. Two names for one fact:
  `packages/core/cli.js` assigns both to its own path on startup, so a server
  started by `ndx start` carries both.
  
  - **Both env rungs are now guarded.** The value is exported to every child of an
    `ndx` process, so it outlives the install that wrote it. A dev-link install
    that moved or was uninstalled left a path that no longer exists, and rung 1
    spawned it anyway — `node <missing file>`, where the rungs below it would have
    resolved.
  - **The ladder is documented as five rungs**, including why there are two env
    names and that the launcher currently outranks the analyzed project's own
    `node_modules/.bin/ndx`. The prose ladder in `routes-hench.ts` named only
    `NDX_CLI_PATH`; the doc comment named only `N_DX_CLI_PATH`. Neither was
    complete.
  
  The ladder tests now cover rung 1 — that it beats both the project-local bin and
  `N_DX_CLI_PATH`, and that a stale value falls through. An ambient `NDX_CLI_PATH`
  answering silently from rung 1 is what left the rungs below it asserting nothing,
  which is how the unguarded return stayed invisible: the suite was red for anyone
  running it from a session `ndx` had launched, and green in CI, which sets neither
  name.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Resolve a requested port of 0 to a real ephemeral port instead of returning the literal 0.
  
  `findAvailablePort(0)` probed port 0 through `checkPort`, whose result is
  platform-dependent: on Linux the connect probe fails `ECONNREFUSED`, the bind
  phase then succeeds (binding 0 always does), and the literal 0 came back as
  the allocated port — `startServer` then logged it, wrote it to the port file,
  and returned it to callers as a port no client can connect to. Windows masked
  the bug by failing the connect probe with `EADDRNOTAVAIL` and falling through
  to the ephemeral allocator, which is why the scoped-route-dispatch integration
  test passed on Windows and died at boot on Linux CI. Port 0 now takes the
  ephemeral allocator directly on every platform, which also skips the pointless
  retry backoff Windows paid while probing it.
  
  Also stops the server calling that resolution a fallback. `PortAllocationResult`
  gains `isFallback` — the request could not be honoured, so a different port was
  substituted — which is deliberately not the inverse of `isOriginal`. For port 0
  the bound port is not the number asked for (`isOriginal: false`) but the request
  was satisfied exactly, so nothing fell back. Both consumers read `!isOriginal`
  and were wrong: the operator saw `Port 0 is in use — using port 54321 instead.`
  about a port that was never in use, and `StartResult.isFallback` told a caller
  that had asked for an ephemeral port it got a fallback. Both now read
  `isFallback`, so a third consumer is correct by default. `isOriginal` keeps its
  documented meaning and its value in every case.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Write only the three known fields when applying a PRD refinement.
  
  `applyRefinements` spread the posted `updates` object into `updateInTree`, which
  is an `Object.assign`. The route's shape check never looks at `updates`
  (`isProposalShape` checks `op`, `id`, `itemId`, and `baseline`), `validateAgainst`
  checks only that it is non-empty and that `priority`, if present, is valid, and
  the TypeScript type is erased at runtime — so a crafted proposal carrying
  `status: "completed"` and `children: []` alongside an honest fingerprint and a
  diff declaring a description change applied all of it and reported `applied`.
  `validateDocument` inside the transaction does not catch that: a childless
  completed epic is schema-valid.
  
  `description`, `acceptanceCriteria`, and `priority` are now picked off `updates`
  individually, at the write, where the next person adding a refinement field is
  already looking.
  
  The model cannot reach this — `RawRefinementSchema` is non-strict so zod strips
  unknown keys, and `buildEdit` constructs `updates` field by field — and
  `request-security.ts` blocks cross-site browser mutations, so this is
  defence-in-depth rather than a closed exploit path. What made it worth fixing is
  that it contradicted the reason the route gives for its own body check being
  structural: that field legality is re-established under the lock. For staleness
  and mutation legality it is; for field scope it was not. That docblock now says
  so and points at where the scope is actually enforced.

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Record which n-dx produced each hench run.
  
  Several checkouts are usually live at once — a worktree per in-flight PR plus a
  linked global install — and their run records were indistinguishable, so a token
  or outcome report could not say which build the numbers came from.
  
  `RunRecord` gains two optional fields, stamped at run start by `initRunRecord`
  and by `hench record`:
  
  - `ndxVersion` — `NDX_VERSION` when an orchestrator exports it, otherwise the
    `@n-dx/hench` manifest version.
  - `cliPath` — `NDX_CLI_PATH` / `N_DX_CLI_PATH` (exported by `packages/core/cli.js`),
    falling back to `process.argv[1]`.
  
  Both are additive: records written before the fields existed load unchanged, and
  the dashboard's run detail renders each row only when its value is present. A
  failed manifest read is not memoized, so one transient error cannot pin every
  later run in the process to a missing version.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - SourceVision Ask: give each degraded mode a specific, actionable message.
  
  The panel's failure card now names the mode it is in rather than reporting
  "The Ask request failed (502)". Missing analysis offers the analyze/refresh
  control itself instead of naming a command; credential failures render
  `@n-dx/llm-client`'s canonical `authFailureGuidance` remediation, ending in
  `VERIFY_CREDENTIALS_STEP`, sent from the endpoint as a new `remediation` field;
  timeout, rate limit, and provider error are each reported as themselves, with a
  retry offered for the two that are transient and the vendor's own retry delay
  stated when it supplied one. The prompt survives every failure.
  
  The endpoint also stops describing one failure while coding another: a typed
  provider error whose message carries no classifiable text now takes its wording
  from the kind it resolved to.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the SourceVision Ask panel usable without sight or a mouse.
  
  An async text exchange has one accessibility requirement the other
  SourceVision subviews do not: the answer arrives after an indeterminate delay,
  so it has to be announced rather than merely rendered. Four defects followed
  from that, and each is now fixed and pinned by a test in
  `tests/unit/viewer/ask-view-a11y.test.ts`.
  
  - **Arrival was not reliably announced.** The answer card was itself the live
    region, so the region came into existence in the same render as its content —
    which screen readers do not reliably announce. There is now one persistent
    polite region, mounted with empty text while idle, and the answer card is a
    `role="region"` labelled by its heading. The test asserts *node identity*
    across the transition, because an equal-looking replacement would satisfy a
    presence check and still fail a reader.
  - **Arrival announced the whole answer.** A live region reads its entire text,
    so a 400-word answer buried the one fact the waiting user needed and talked
    over whatever they were reading. The region now reports that the answer is
    ready, how long it is, and where to find it; the answer is read on demand.
    Making the card live also meant a live *ancestor* claimed every descendant
    update, so each later "Copied" line re-read the answer with it.
  - **Submitting stole focus.** The textarea and the submit button were both
    `disabled` while the request was in flight, and the browser blurs a disabled
    element — so pressing Enter in the prompt, or Enter on the button, dropped
    focus to `<body>` and left a keyboard user at the top of the document for the
    length of an LLM call. The textarea is now `readOnly` and the button carries
    `aria-disabled`; `submit()` already refused the second request, so nothing
    needed to be disabled to prevent one.
  - **Success and failure differed only in hue.** Both feedback lines now carry a
    shape marker as well as a colour, and a capture failure adds a
    screen-reader-only "Capture failed:" prefix — its message comes from the
    server and may state a fact ("PRD is locked by pid 4212") that does not read
    as a failure on its own.
  
  The panel also joins the axe-core audit (idle and deployed-mode states, light
  and dark), and `docs/accessibility.md` gains the behavioural-suite table that
  records what axe cannot check.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Wire Copy and Capture-to-PRD actions onto a SourceVision Ask answer
  
  Two controls under an answer, plus one shared clipboard module and one new PRD
  write route.
  
  **Copy reuses the PR Markdown view's path rather than reimplementing it.** The
  copy attempt, the `execCommand` fallback, the permission-denied classification,
  and the user-facing wording all move to `viewer/utils/clipboard.ts`, which the
  Ask panel and `pr-markdown.ts` now share — two consumers, so it clears the
  two-consumer rule without becoming a single-consumer module. `copyTextToClipboard`
  returns a discriminated result (`{ok: true}` or a named `reason`), so the
  branching lives in one place: the modern API is skipped entirely when absent
  rather than called and allowed to throw, and a fallback that succeeds reports
  success whatever the first attempt's reason was. The four PR Markdown strings
  are reproduced byte-for-byte and pinned by a test, so a permission denial reads
  identically on both surfaces.
  
  **Capture is confirm-guarded, and says where the item landed.** The first press
  only arms the action; nothing is written until Confirm — the shape the Overview
  Next Steps panel uses, and for the same reason. `POST /api/rex/capture-ask`
  files the exchange as a **task** under a find-or-create "SourceVision Ask"
  epic (`LEVEL_HIERARCHY` accepts a task under an epic, so no filler feature has
  to be invented), and the response names the created item, its parent, and
  whether the epic is new — "Captured to PRD" alone leaves the user hunting for
  what they just filed.
  
  **Deliberately no title dedup, unlike `capture-next-steps`.** There the same
  recommendation recurs on every analysis and skipping it is a kindness; here the
  user pressed Confirm on this specific answer, so discarding the write because
  they once asked something similar would be a capture that reports success and
  files nothing. Repeat presses are guarded by the confirm step plus an in-flight
  ref instead.
  
  A failed capture surfaces the endpoint's own reason in an `alert` region and
  leaves the answer intact and re-copyable. Both kinds of feedback are transient
  and both are dropped when a new question is submitted — including when that
  question fails — so a "Copied" or "Captured" line can never be read as
  belonging to an answer it did not come from. Capture's window is five times
  Copy's, because its message names a destination the user needs time to read.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `POST /api/sourcevision/ask`, answering a question from the existing analysis
  
  The SourceVision Ask panel's server half. The request is
  `{ prompt, seed? }` validated by a zod schema; the response is
  `{ answer, vendor, model, tokens, contextSources }`.
  
  **Bundle, not a tool-use loop.** Context is pre-assembled from the
  `.sourcevision/` artifacts already on disk — manifest, inventory, imports,
  zones, findings, derived next steps, component count, and a `CONTEXT.md`
  excerpt — and sent in a single non-agentic call. A loop that queried lookups on
  demand would answer a wider range of questions, but at an unbounded number of
  round trips per question and with no way to test what the model actually saw. A
  unit test now asserts the assembled facts reach the completion request, which is
  the property the whole endpoint rests on. Every section is capped and reports
  what it cut, so the bundle does not grow with the repository until the vendor
  rejects it as an opaque 400.
  
  **Analysis is the only ground truth.** The endpoint reads no source, and refuses
  with `no_analysis` rather than letting the model answer from its priors when
  nothing has been analysed. All sourcevision access — including the five artifact
  schema types the reads are parsed against — goes through
  `server/domain-gateway.ts`; the gateway's export cap moved 15 → 16 with that
  reason recorded.
  
  **Named failures, and it cannot hang.** Vendor and model come from the project's
  own config via `loadLLMConfig` + `resolveTaskModel` (new `sourcevision.ask`
  class, standard tier, reroutable through `llm.routes`), and the pair that served
  the call is reported back so the panel never has to guess which model produced
  an answer. The call races a budget — `sourcevision.ask.timeoutMs`, default 120s,
  also passed down so a CLI-mode child bounds itself — and every failure returns a
  named `kind` (`timeout`, `rate_limit`, `auth`, `network`, `no_analysis`,
  `invalid_request`, `llm_error`) with the vendor's retry delay when it supplied
  one, instead of a generic 500. A provider that already threw a typed
  `ClaudeClientError` is trusted over re-classifying its message, so a 429 the
  provider knew about is never downgraded to `unknown`.
  
  The task-class registry contract test now scans `web` as well as the three
  domain packages: web declares classes now, and an unregistered one there
  resolves silently to the standard tier exactly as it would anywhere else.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Explain a SourceVision finding in plain language from the Problems and
  Suggestions views.
  
  Every finding row now carries an **Explain** action that opens the Ask panel
  with that finding attached. What travels is the finding's own fields — type,
  severity, zone, message, and related files — as a structured `seed` beside the
  prompt, not a pre-written sentence. That distinction is the feature: facts in
  the question text would be deleted the moment the user reworded it, and a
  prompt is not something the endpoint can render as a focus section or reason
  about.
  
  The endpoint already accepted a loose `{kind, id, text}` seed. It now also
  takes `zone`, `files`, and a `labels` map, renders them as their own facts, and
  — only when a seed produced a focus section — adds three rules requiring the
  answer to name that finding's zone and files and to state what a fix would
  touch. An explanation that could have been written without reading this
  repository is the failure mode, so the extra rules say so outright.
  
  Details worth knowing:
  
  - **Nothing is defaulted on the way through.** A finding with no severity sends
    no severity; the list view's "treat missing as info" grouping default stops at
    the display layer, because telling a model the analysis classified something
    it did not classify is inventing the field the explanation reasons about.
    A `global` finding sends no zone rather than the string `"global"`.
  - **The seed is shown as well as sent, and can be detached.** An answer naming
    files the user was never shown reads as a guess; a seed that could not be
    removed would silently ground every later question in whichever finding they
    arrived from.
  - **Explain is opt-in per surface.** `FindingsList` also renders for the
    Architecture view, which has nowhere to send a finding, so the action appears
    only where a navigation target exists. The button sits outside the row header
    because that header is itself a button whenever a finding has related files.
  - The seeded answer supports the same Copy and Capture-to-PRD actions as any
    other, and an unknown `seed` field is still rejected rather than dropped — a
    client that guessed the shape is told, not quietly answered without it.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the gated SourceVision "Ask" tab and its prompt/response panel
  
  The client half of the Ask panel: a tab in `SOURCEVISION_TABS` behind the
  default-off `sourcevision.ask` feature flag, and a view registered in
  `view-id.ts`, `view-routing.ts`, and `view-registry.ts` so `/ask` deep-links and
  survives a reload like every sibling tab. The panel owns the labelled prompt
  textarea and the submit control, and consumes `POST /api/sourcevision/ask` — it
  assembles no context and calls no model itself.
  
  **One state value, not three booleans.** `idle | submitting | answered | error`
  is a discriminated union. The `loading`/`error`/`data` triple the older views
  use admits eight combinations for four legal states, and the illegal ones
  ("submitting and answered") are exactly the renders that read as a bug to
  someone waiting on an answer.
  
  **An empty prompt is not a request.** A whitespace-only prompt disables the
  submit control *and* returns early from the handler an Enter keypress reaches,
  so it never costs a round trip to be told you typed nothing. A concurrent
  submit is refused through a ref rather than through `state.status`, which has
  not been applied yet when a double click's second handler runs. A 200 carrying
  an empty answer is reported as an error rather than rendered as a blank card.
  
  **`requiresServer`, so a static export hides it.** The answer is an on-demand
  LLM call and `ndx export` has no such route — deployed mode's fetch adapter
  answers every non-GET with a 405 — so the tab is hidden there and the view
  renders the explanatory card instead, matching the isometric map's contract.
  
  Copy/Capture actions on the answer, per-failure-mode wording beyond what the
  endpoint supplies, and seeding the prompt from a finding are separate tasks
  under the same feature; the shell is shaped so each lands in one place.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Stamp `lastModified` on tree mutations made inside `store.withTransaction`.
  
  Only the single-item store methods (`addItem`/`updateItem`/`removeItem`)
  stamped. Every batch write mutates the tree directly inside a transaction and
  so bypassed them: the dashboard's bulk update and merge routes, the Ask panel's
  apply-refinements, and the CLI restructurers. The item was written to disk
  looking untouched.
  
  That is silent in both directions. `isModifiedSinceSync` asks whether
  `lastModified > lastSyncedAt`, so a previously-synced item whose stamp never
  advanced is skipped on push; `resolveConflicts` then does last-write-wins on
  local versus remote time, and with the local time stale the next
  `sync_with_remote` overwrites the local change with the remote's value. Nothing
  reports either half. Reachable on any project configured with a remote adapter.
  
  The stamp now belongs to the transaction rather than to each caller —
  `FileStore.withTransaction` and `FolderTreeStore.withTransaction` signature the
  tree before running the callback and stamp whatever changed, via
  `snapshotItemContent` / `stampChangedItems` in `core/sync.ts`.
  
  Deliberate details:
  
  - **Changed, not merely present.** `migrate-slugs` and `reshape` each open an
    empty transaction purely to force a rewrite; stamping unconditionally would
    mark every item in the PRD modified and queue the whole tree for push.
  - **A parent whose child list changed counts as changed**, which is what
    `removeItem` already did by hand for exactly this reason.
  - **A stamp the item arrived with is kept.** `analyze.ts` stamps its accepted
    items before opening its transaction, deliberately; only an item that is new
    to the tree *and* unstamped gets one here.
  - **Sync bookkeeping is excluded from the signature** (`lastModified`,
    `lastModifiedBy`, `lastSyncedAt`, `remoteId`) — including any of them would
    make a stamp, or a recorded sync, look like a further modification.
  - **The actor is resolved before the lock is taken.** `resolveActor` shells out
    to `git config` on first call; doing that inside the locked span puts a
    subprocess between every other writer and the PRD.
  
  The remote adapters keep their own lock-free `withTransaction` unchanged: they
  push to systems where these timestamps mean something different.

- [#359](https://github.com/en-dash-consulting/n-dx/pull/359) [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx start` asks who is on the port before killing it, and steps aside for another project's dashboard.
  
  The PID file `runWeb` consults lives inside the directory it was given, so a
  second project or worktree had no entry there. A busy 3117 therefore read as a
  stranger squatting on the port and `killPortOccupant` SIGKILLed it — including
  when the occupant was another project's working dashboard. The server's own
  fallback allocator (`findAvailablePort`, 3117–3200) never got a chance to run,
  because the orchestrator killed first.
  
  A busy port is now probed with a 1.5 s `GET /api/status` before anything is
  killed:
  
  - an n-dx dashboard reporting a **different** `projectDir` is left alone, and
    this invocation moves to the next free port in 3117–3200;
  - an n-dx dashboard reporting **this** directory is restarted as before — that
    is `ndx start`'s documented idempotency, reached here when the PID file is
    missing;
  - anything else, including a dashboard too old to report `projectDir`, keeps
    today's behaviour exactly. An inconclusive probe never widens the kill.
  
  `GET /api/status` gained a top-level `projectDir` so the probe has something to
  attribute the server by. Purely additive.

- [#359](https://github.com/en-dash-consulting/n-dx/pull/359) [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - GET /api/status and GET /api/config now include a `server` object — `projectDir`,
  `version`, `cliPath`, `pid`, `port`, `startedAt` — identifying the running dashboard
  process itself, not just the project it serves. `version` and `cliPath` come from the
  same resolution the dashboard already uses to spawn `ndx` commands (`@n-dx/web`'s own
  `package.json`, and the `NDX_CLI_PATH`/`N_DX_CLI_PATH` env vars set by `cli.js`), so
  `ndx which`/the viewer footer can report them without re-deriving them. Purely
  additive: existing fields on both routes are unchanged.

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - fix(web): retry readWebVersion() after a transient read failure
  
  `readWebVersion()` (used by GET /api/status and GET /api/config's `server`
  object) memoized its own failure: a read of `packages/web/package.json`
  that fails transiently — EMFILE under descriptor pressure, a slow mount not
  yet ready during a startup burst — assigned the sentinel `"unknown"` to the
  module-level cache, and the truthy check on re-entry then returned
  `"unknown"` for the life of the process even once the file was readable
  again.
  
  The catch path now returns `"unknown"` without populating the cache, so the
  next call retries. A successful read is still memoized permanently, since
  the file does not change under a running process.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Define the monospace token the viewer's panels ask for, and repair three that existed nowhere
  
  `--mono`, `--line` and `--panel2` were referenced without a fallback in `pr-markdown.css` and `commands.css` and defined in no stylesheet, so those declarations were dropped: the markdown and command panels rendered in the inherited sans stack, on transparent surfaces, with no borders. They now point at `--font-mono`, `--border` and `--bg-surface`.
  
  `--font-mono` is newly defined. Eight other stylesheets already referenced that name through a `monospace` fallback, so they were getting the fallback rather than the intended stack.
  
  A test now asserts that every token used without a fallback resolves. The viewer carries a backlog of these — `llm-provider.css` is written against a `--color-*` / `--spacing-*` scheme the project never adopted — which the test allowlists rather than fixes, since choosing replacement values is a visual decision. The allowlist is itself checked for staleness, so an entry that gets defined has to be removed rather than quietly granting permission to break it again.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop an out-of-scope POST to `/api/sourcevision/ask` from killing the server.
  
  `handleApiRoutes` gated the ask route with
  `handleScopedRoute(isInScope(...), handleSourcevisionAskRoute(req, res, ctx))`.
  The second argument is a value, so the handler was invoked before the guard was
  read. With `--scope=rex` (or any scope excluding sourcevision) the handler ran
  anyway, reached the model call, and then wrote to a response the dispatcher's
  404 fall-through had already finished — throwing `ERR_HTTP_HEADERS_SENT` from an
  unawaited promise, which terminates the process on Node 22. One local POST took
  down the dashboard, having first paid for an answer nobody received.
  
  The scope check now happens before the handler is invoked, matching the
  synchronous siblings on either side of it.
  
  The eager-evaluation shape is not unique to this route — `handleScopedRoute` has
  it at every call site, and the same crash reproduces on `/api/notion/sync` under
  `--scope=sourcevision`. That is pre-existing and tracked separately; this change
  fixes only the route that reaches an LLM, and leaves a comment at the call site
  explaining why the guard is inline rather than delegated.
  
  Covered by `tests/integration/scoped-route-dispatch.test.ts`, which boots the
  real server in a child process — the existing ask-route tests mount the handler
  directly and never touch the dispatcher, which is why they passed throughout.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Make `handleScopedRoute` take a thunk, so an out-of-scope route cannot run.
  
  The helper took the handler's *result*, which meant every call site had already
  invoked its handler before the scope guard was read. On a false guard the
  promise was neither awaited nor cancelled: the handler ran on, wrote to a
  response the dispatcher's 404 fall-through had already finished, and threw
  `ERR_HTTP_HEADERS_SENT` from an unawaited promise — which ends the process on
  Node 22.
  
  Probing the previous build under `--scope` showed `/api/notion/*` and
  `/api/merge-graph` were reachable this way. The other scoped routes escaped only
  because they do not accept POST on the paths probed and so returned without
  writing — luck, not a guard, and it held whether or not the project was
  initialised.
  
  The parameter is now `() => RouteResult`, invoked only when the guard passes, so
  passing an already-invoked handler is a compile error (`TS2345`) rather than a
  latent crash. All eleven call sites are migrated, including the ask route, whose
  one-off inline guard from the previous fix is folded back into the shared
  mechanism.
  
  Also removes `resolveRouteResult`, a no-op ternary whose two branches were
  identical (`result instanceof Promise ? result : result`) and whose only caller
  was this helper — `await run()` covers both sync and async handlers.
  
  `tests/integration/scoped-route-dispatch.test.ts` gains cases for the two
  reachable routes; it boots the real server in a child process, because the
  per-route unit tests mount handlers directly and never touch the dispatcher.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - SourceVision Ask: propose and apply PRD refinements, reviewed as diffs and written under the store lock.
  
  A new opt-in refine mode sends the PRD with the question and lets the answer carry proposed changes to existing items — a rewritten description, replacement acceptance criteria, a different priority, a reparent, or a merge with a duplicate sibling. Each proposal renders as a before/after diff of exactly the fields it changes and is accepted or rejected on its own; rejecting issues no request at all.
  
  Accepted proposals go to `POST /api/rex/apply-refinements`, which applies them through the rex gateway's `resolveStore` inside `withTransaction`. A proposal whose item changed since the answer was generated is refused as stale rather than applied over the top of whoever changed it, and a PRD lock held by another writer fails the request loudly, naming the holder's PID.
- Updated dependencies [[`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`72609db`](https://github.com/en-dash-consulting/n-dx/commit/72609db1c4572f94ef25a2178d5cac2c17e241dc), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9)]:
  - @n-dx/rex@0.6.0
  - @n-dx/llm-client@0.6.0
  - @n-dx/sourcevision@0.6.0

## 0.5.2

### Patch Changes

- [#345](https://github.com/en-dash-consulting/n-dx/pull/345) [`0c9c31d`](https://github.com/en-dash-consulting/n-dx/commit/0c9c31da941fc92ec6ce14e6ed2e3d6c3fcfecae) Thanks [@endash-shal](https://github.com/endash-shal)! - Mark where the SourceVision Ask panel and its Rex/Hench siblings will land
  
  The PRD gained a "SourceVision Ask Panel" feature — a gated text exchange over
  the analysed project that can explain a finding in plain language and propose
  PRD refinements. The code side of this branch is markers only, no behaviour: a
  placement comment in `SOURCEVISION_TABS` for the gated `Ask` tab, plus adoption
  markers in `domain-rex.ts` and `domain-hench.ts` for the two surfaces that want
  the same panel afterwards.
  
  The Rex and Hench panels are intentionally absent from the PRD. The sequence is
  to build the SourceVision one, generalise it, then lift the shared piece out —
  so the markers record the intent (and, for Rex, that a panel there must reuse
  the existing `withTransaction` apply path rather than adding a second PRD write
  surface) without implying scheduled work.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Count and price cache tokens in every usage rollup.
  
  Run records carry four token fields — input, output, cacheCreationInput,
  cacheReadInput — but the rollups summed only the first two, and neither cost
  estimator priced the cache at all. On this repo `ndx usage` reported 1,212,931
  tokens and $18.00 across 1,024 runs; the same runs actually hold 668,969,084
  tokens and cost roughly $237.74. Cache reads alone were 662M of that, 99% of
  all tokens and completely invisible.
  
  Cache tokens are billed, not free: a write costs about 1.25x the input rate and
  a read about 0.1x. Dropping them did not make the estimate approximate, it made
  it wrong by more than an order of magnitude — and it hid the one number the
  cost work moves, since batching and warm-parent forking trade fresh input for
  cache reads.
  
  `PackageTokenUsage`, `AggregateTokenUsage`, and `TokenEvent` now carry
  `cacheCreationTokens` and `cacheReadTokens` through extraction, grouping, and
  aggregation. `ModelPricing` gains cache rates and `CostEstimate` reports the
  two new cost components. CLI output breaks the four kinds out rather than
  collapsing them, since they bill at four different rates — cache segments are
  omitted when zero, so a project that never caches keeps the old two-part line.
  
  The dashboard already counted cache tokens but never priced them; its
  `estimateCost` now matches. Because the dashboard keeps a second copy of the
  aggregation, a new parity test pins the two pricing tables and both cost
  formulas to each other so they cannot drift into quoting different dollar
  figures for the same runs.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - The isometric map is now a dashboard view instead of a link out to a raw page.
  
  **SourceVision → Isometric Map** renders the map inline and puts its generation options in the UI: Source (auto / SourceVision analysis / direct scan), Max nodes (1–500) and an externals toggle, with Generate, Open in new tab and Download HTML. Each request is fetched by the view rather than handed straight to the frame, so "no analysis yet" arrives as a readable card that points at `ndx analyze` or the direct-scan option instead of a JSON error page rendered inside the map. The map document itself runs in a scripts-only sandbox — it needs scripts for pan, zoom and zone selection, and nothing else.
  
  The view is hidden from navigation in an exported dashboard, where no server exists to build the map, and the Architecture page's old external link now points at the view.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix two isometric-map defects the new UI smoke test exposed.
  
  `ndx init` writes empty `.sourcevision/` data files before anything has been analyzed, so `hasSourcevision()` was true on a freshly-initialized project and auto mode never fell back to a scan. A project full of source that had not been analyzed yet reported "nothing to map". Auto now falls back when the analysis parses but contains no zones.
  
  `GET /api/iso-map` answered 404 for "this project has nothing to map yet". That is a state of the map, not a missing resource, and a 4xx on a `fetch` writes a network error into the browser console — which `tests/e2e-ui/navigation.spec.ts` requires every view to load without. It now answers 200 with an `x-iso-map-empty` marker header and a readable empty-state page, so the viewer still renders its own empty card and anyone opening the URL directly gets a page rather than a JSON blob. Genuine faults (bad parameter, wrong method, build failure) remain 4xx/5xx.
  
  Also adds the `iso-map` and pre-existing `pr-markdown` views to the navigation smoke test, whose list is meant to track every `ViewId`.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - Iso map: one implementation, several gaps closed.
  
  The standalone skill script is now generated from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs` rather than hand-maintained, so the map has a single source of truth; `tests/e2e/iso-skill-drift.test.js` fails if the committed bundle goes stale, and also executes it. This removed a real divergence where the two copies disagreed on zone colours because one counted archetypes before mapping them to kinds and the other after — kinds are now resolved per file and counted once, which answers "what does this zone do" rather than "what is its most common file type".
  
  Also: the project scanner moved into the package (`iso-scan.ts`) and gained tsconfig `paths`, workspace-package and Go `go.mod` resolution, so a monorepo's own packages stop looking third-party; call-graph data, when present, adds per-edge runtime call counts with a Weight: imports/calls toggle and surfaces call-only edges as injected seams; output is reproducible (timestamps default to the HEAD commit time); key files link to source via the git remote; multi-layer edges route through corridors between rows instead of cutting through blocks; and the page gained a light theme, reduced-motion support, kind glyphs alongside colour, a skip link, and a tab order of one stop per zone instead of one per connector.
  
  New: `ndx iso`, `sourcevision iso --source=scan`, and `GET /api/iso-map` in the web dashboard.

- [#347](https://github.com/en-dash-consulting/n-dx/pull/347) [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Protect the loopback dashboard from cross-origin state changes by rejecting untrusted browser mutations and replacing wildcard CORS with a validated loopback origin.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Expose the task-routing config surface in `ndx config` and the dashboard.
  
  `ndx config` now validates `llm.tiers.<vendor>.<tier>`, `llm.routes.<class>`,
  `llm.effort.<class>`, and `llm.escalation.*`, and documents them in `--help`
  along with the fact that top-level `llm.model` is a standard-tier shorthand
  rather than a global override. The dashboard's LLM config route accepts the
  same keys, plus `llm.model` itself — writable via the CLI but previously absent
  from the route's allowlist, so the field with the highest precedence over the
  model actually used was invisible in the UI.
  
  Validation is deliberately asymmetric. Values are checked strictly, and so is
  the shape of a tier path: an unrecognized vendor or tier there is a typo, never
  a feature. Route and effort *class names* stay open, because glob keys
  (`prd.*`, `*`) are the documented routing design and this layer cannot see the
  task-class registry without importing across a tier boundary.
  
  Both surfaces also had to learn that task classes contain dots. Since config
  paths use dots as separators, `llm.routes.agent.execute` would otherwise write
  a nested `{agent: {execute}}` object — which the flat-map extractor in
  `loadLLMConfig` silently ignores, making the setting appear to work while
  changing nothing. Those two sections now treat everything after the section
  name as one literal key, on both the read and write paths.
- Updated dependencies [[`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`0c9c31d`](https://github.com/en-dash-consulting/n-dx/commit/0c9c31da941fc92ec6ce14e6ed2e3d6c3fcfecae), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec)]:
  - @n-dx/rex@0.5.2
  - @n-dx/llm-client@0.5.2
  - @n-dx/sourcevision@0.5.2

## 0.5.1

### Patch Changes

- [#339](https://github.com/en-dash-consulting/n-dx/pull/339) [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12) Thanks [@endash-shal](https://github.com/endash-shal)! - Add Gemini support to the dashboard LLM Provider view, and complete the documentation cleanup
  
  The dashboard offered claude / codex / local only, so a project configured with
  `llm.vendor google` could not see or edit its model settings there and
  `llm.google.*` was absent from the config API response. Gemini is now a
  first-class vendor in that view.
  
  Also completes the outstanding documentation findings: removes the removed
  `prd.md` + `prd.json` dual-write architecture from the rex README (including an
  unreplaced `![img_here](img_here)` placeholder that shipped to npm), corrects
  the Node floor to match `engines: >=22`, completes the command references, and
  deletes or archives superseded docs.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - A run file that cannot be read is no longer treated as a run file that changed.
  
  Both change detectors trust mtime only once it is older than the filesystem's timestamp granularity, and inside that window compare a hash of the bytes instead. `hashFile` returns null when the read fails, and both docblocks promised the caller treats that as "no usable hash" rather than as a change. Neither caller did: the comparison guarded the *previous* hash against null but not the new one, so a previously-hashed file whose read now failed compared `"abc" !== null` and was reported modified.
  
  In the web aggregator that was the expensive direction to get wrong. "Modified" means subtract-then-re-read, and when the re-read failed too the contribution was dropped outright — so a momentarily unreadable run file silently lost its tokens from the per-task aggregate until something else touched it. Absence of evidence became a deletion. The hench detector only reports the change without mutating an accumulator, so the cost there was a spurious change flag.
  
  Both now require *both* hashes to be usable before a difference counts. mtime and size already agree at that point, so nothing suggests a rewrite — only that this scan could not check, which is not the same thing. Each side gained a test that injects the read failure (reproducing it from the filesystem is platform-specific; the branch is not) and asserts the file's tokens survive it, with a precondition check so it cannot pass vacuously when no hash was being carried.
  
  Fixed in both copies together, as the twins' shared rule requires. Note for anyone tracing this: there is no parity test between these two detectors and there was never meant to be — `incremental-task-usage.ts` explains why they are deliberately unshared and unpaired, unlike the `quoteWindowsToken` twins.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop re-hashing unchanged run files on every dashboard poll.
  
  The incremental task-usage aggregator trusts mtime only once it is older than the filesystem's timestamp granularity; inside that window it also carries a hash of the file's bytes, so an equal-length rewrite that reused the same mtime is still visible. The contract is that a file is hashed for the scan or two following its last write and never again, which requires re-snapshotting surviving files on every scan so the hash is dropped once the mtime ages out.
  
  That re-snapshot loop sat *after* the no-change short-circuit, so on quiet polls — the common case — it never ran. A file first observed inside the granularity window kept `mtimeMayBeShared` set for the life of the process and was re-read and re-hashed on every poll, which is exactly the steady-state cost the snapshot design exists to avoid. On a busy `.hench/runs/` directory that is a full read of every recently-written run file, every poll, forever.
  
  The loop now runs before the short-circuit. Its placement is bounded on both sides and the code says so: after categorisation, which needs the previous snapshots to compare against, and before the early return, because quiet scans are precisely the ones it has to run on. The short-circuit still guards the contribution work, so a quiet poll does no subtract/re-read — verified by a test, since re-snapshotting earlier must not turn a quiet poll into a re-aggregation.
  
  Results were never wrong, which is why this was invisible from the outside: the defect was in what the cache retained and re-read. The three new tests therefore assert the private snapshot state and the hash-call count, including a precondition check so they cannot pass vacuously if the first scan lands outside the window.
  
  hench's `RunChangeDetector` twin is unaffected — it has no short-circuit and rebuilds its checkpoint from every scan, so its hash drops on schedule.

- [#339](https://github.com/en-dash-consulting/n-dx/pull/339) [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12) Thanks [@endash-shal](https://github.com/endash-shal)! - Update LLM model catalogs to current vendor releases
  
  Refreshes the Claude, Codex, and Gemini model catalogs and fixes several
  incorrect context-window and pricing entries. Two of the previous defaults
  pointed at models that are no longer usable.
  
  **Claude**
  - `claude-opus-4-8` → `claude-opus-5` in the init catalog, the `opus` shorthand
    alias, and the `heavy` tier (was `claude-opus-4-7`).
  - Added a `fable` shorthand alias for `claude-fable-5`.
  - Corrected context windows: `claude-sonnet-4-6` and `claude-opus-4-7` are 1M
    models, not 200K.
  - Corrected pricing: `claude-haiku-4-5` is $1.00/$5.00 (was $0.80/$4.00) and
    `claude-opus-4-7` is $5.00/$25.00 (was $15.00/$75.00).
  - Default remains `claude-sonnet-5`.
  
  **Codex** — GPT-5.6 replaces the GPT-5.4/5.5 line
  - Default is now `gpt-5.6-terra` (was `gpt-5.5`), with `gpt-5.6-sol` as a new
    `heavy` tier (codex previously had no tier above standard) and `gpt-5.6-luna`
    as `light` (was `gpt-5.4-mini`).
  - `gpt-5.4` and `gpt-5.4-mini` retire from ChatGPT-authenticated Codex sessions
    on 2026-08-31; `gpt-5.3-codex` and `gpt-5.2` are already unavailable there.
    All four are now legacy aliases that normalize to OpenAI's stated
    replacements, so existing `.n-dx.json` files keep working after upgrade.
  - `gpt-5.5` is still supported and remains a selectable catalog entry.
  - `openai-api-provider` default was `gpt-4o`; now `gpt-5.6-terra`.
  
  **Google**
  - `gemini-2.0-flash` has been **shut down** by Google and was the configured
    `light` tier — replaced with `gemini-3.5-flash-lite`. `standard` moves from
    `gemini-2.5-flash` to `gemini-3.7-flash`.
  - `heavy` intentionally stays on `gemini-2.5-pro`, the newest *stable* Pro
    model. `gemini-3.1-pro-preview` is newer but is a preview release whose ID
    may be renamed or withdrawn; it remains selectable via `llm.google.model`.
  - Corrected `gemini-2.5-flash` pricing to $0.30/$2.50 (was $0.15/$0.60).
  
  Also refreshes the dashboard's model suggestions, which still listed retired
  IDs (`claude-haiku-3-5`, `claude-3-7-sonnet-20250219`, `o3`, `o4-mini`), and
  updates model examples in `ndx config --help`, `ndx init --help`, and the
  configuration guide.

- [#331](https://github.com/en-dash-consulting/n-dx/pull/331) [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Add `--verbose`/`--debug` live progress across `ndx init` and `sourcevision analyze`, and replace scattered vendor string literals with shared `LLM_VENDOR` constants.
  
  **Live progress instrumentation.** `ndx init` gave no visibility into a slow `sourcevision analyze` run — `--debug` reached the child process but its output was fully captured and discarded on success, so a slow run was indistinguishable from a hung one. `ndx init`'s spinner now forwards the child's own progress live (throttled so a high-volume `--debug` firehose can't stall the pipe via backpressure), and the Components phase (component parsing, route detection, server-route detection) gets per-operation timestamped tracing plus automatic gap detection that flags any silence past 250ms by naming the last known checkpoint. A worker-thread-backed live stopwatch prints an incrementing "current operation runtime" for any operation still in flight — verified to keep ticking even during a fully synchronous, non-yielding block, which a same-thread timer cannot do. `hench`'s shell tool gets equivalent live-tail output for long-running commands.
  
  **Fixed a real infinite loop this instrumentation surfaced.** `inferPrefix` (server-route prefix inference) could spin forever on any two ordinary routes that share no deeper common path (e.g. `/users/:id` and `/orders`) — confirmed live via a CPU sample showing 100% of time in `String.prototype.lastIndexOf`. Also tightens `isLikelyRouteFile` so a client-side `api/` directory (axios/fetch-style callers, not Express-style route definitions) is no longer scanned for server routes at all, and adds a length guard against any future misextracted route "path" that's actually an unrelated string literal.
  
  **Vendor literal consolidation.** Replaces hardcoded `"claude"`/`"codex"`/`"google"`/`"local"` string comparisons throughout `core`, `hench`, `rex`, `sourcevision`, and `web` with the canonical `LLM_VENDOR`/`DEFAULT_LLM_VENDOR`/`LLM_VENDORS`/`isLLMVendor` helpers exported from `provider-interface.ts` and re-exported through each package's llm-client gateway, so the supported-vendor set has one source of truth instead of being duplicated ad hoc at each call site.
  
  **Fixed `ndx config <key>` incorrectly reporting an initialized project as stale.** The pre-dispatch directory resolver used for the staleness check and command-timeout config load treated a config key like `llm` as a target directory when no explicit directory argument was given, so `ndx config llm` looked for `.sourcevision`/`.rex`/`.hench` under a nonexistent `llm/` subdirectory and reported a fully-initialized project as uninitialized.
- Updated dependencies [[`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`2bb6a4c`](https://github.com/en-dash-consulting/n-dx/commit/2bb6a4c240e61aa34bf0d240e7ffc26c7e5a4dab), [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9)]:
  - @n-dx/rex@0.5.1
  - @n-dx/sourcevision@0.5.1
  - @n-dx/llm-client@0.5.1

## 0.5.0

### Patch Changes

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - New Adaptive Optimization view (HENCH → Adaptive) consuming the previously UI-less /api/hench/adaptive routes: recent-run metrics with trends, recommended adjustments with apply/dismiss/lock actions, adaptive settings with locked keys and manual overrides, and the full adjustment history.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The Overview's Re-analyze and Full analysis triggers now use the standard dashboard button styles (`cmd-btn-primary` / `cmd-btn-secondary`) instead of the low-emphasis inline-trigger look.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The LLM credential chip no longer spawns `ndx auth` on every settings-page visit: the server caches the check result for its lifetime, invalidates it when LLM config is saved, dedupes concurrent requests into one spawn, and the Re-check button forces a fresh run via `?refresh=true`.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - A failing CI check in the Validation view now renders the CI report it produced (with its pass/fail state) instead of a raw error banner — the banner is reserved for runs that yielded no report at all.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - GET /api/project now returns the resolved cliName, and the viewer gains a useCliName() shared-state hook — the single read path for the project CLI name in dashboard components. The default CLI name across all resolvers is now "n-dx".

- [#309](https://github.com/en-dash-consulting/n-dx/pull/309) [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Close out Codex workflow parity ([#122](https://github.com/en-dash-consulting/n-dx/issues/122)) and fix the skill-tracking asymmetry ([#284](https://github.com/en-dash-consulting/n-dx/issues/284)).
  
  - **Body-drift regression test** — a new e2e test regenerates the assistant artifacts from the canonical source (`assistant-assets/`) and asserts the committed `CLAUDE.md`, `AGENTS.md`, and every vendor `SKILL.md` match the generator. This closes the last acceptance gap of [#122](https://github.com/en-dash-consulting/n-dx/issues/122) (tests now fail on body drift, not just inventory drift). It immediately caught a real drift: the committed `CLAUDE.md` carried a `## Changeset Versioning` section that was never in the canonical `project-guidance.md`, so `AGENTS.md` silently lacked it — that section is now in the shared source and both instruction files carry it.
  - **[#284](https://github.com/en-dash-consulting/n-dx/issues/284) — commit both:** the generated Claude `ndx-*` skills were gitignored while the Codex skills were committed, so cloned checkouts lacked the `/ndx-*` skills for Claude until re-init. `.claude/skills/` is removed from `.gitignore`, the generated skills are committed (and LF-pinned in `.gitattributes`, matching `.agents/skills/`), and `ndx init` now warns via `checkSkillTracking()` when an enabled assistant's skill directory is gitignored.
  - **Docs sweep:** the web package README and the troubleshooting guide no longer describe MCP setup as Claude-only.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Declare `color-scheme` on the theme roots so native form chrome (select dropdown popups, number-input spinners, scrollbars, autofill) renders in the active theme's scheme instead of always light — most visible on the input-heavy settings pages in dark mode.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - New Commands reference section: a server-driven manifest (GET /api/commands/manifest) lists every CLI command grouped by workflow stage with the project-resolved CLI name and computed availability (available / needs init / needs LLM), rendered in a dedicated All Commands view with its own sidebar section.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Commands reference rows gain inline Run buttons for dashboard-triggerable commands: the manifest now declares each command's trigger endpoint (and status endpoint for async runs), and rows show live running state plus a last-run outcome without a page reload. Commands without trigger support stay read-only with their resolved CLI invocation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard command references now use the project's resolved CLI name instead of a hardcoded one. Sidebar and breadcrumb labels, page titles, FAQ answers, settings hints, and every panel's "equivalent to" snippet read from shared state, so a project whose binary is `myapp` sees `myapp work` throughout. Constant tables carry a `{cli}` placeholder resolved at render; a guard test fails the build if a bare command reference reappears in viewer source. Also removes a duplicate `document.title` writer in main.ts — Breadcrumb owns the title, and the second writer was racing it.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix an import-graph history bug and make the web test suite deterministic under parallel load.
  
  Dependency-preview **Back** could be permanently disabled: clicking a file before the focus-history seeding effect flushed (slow first paint) dropped the outgoing file, so history held a single entry. Seeding now happens synchronously with the click.
  
  Test-side: route tests bind and fetch `127.0.0.1` (never `localhost`), await server close so ephemeral ports are fully released, and reset process-wide route state via `resetHenchRouteStateForTests()`. The DOM-counting complexity test counts traversal steps instead of comparing elapsed-time ratios, and gesture-driven graph tests re-dispatch inside `waitFor` rather than firing once at a listener that may not be attached. Rules for both failure families are documented in TESTING.md.
  
  The web package typecheck now also covers `packages/web/tests`, so test-only type and syntax errors fail `pnpm typecheck` instead of surfacing later during Vitest transforms.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a dashboard "Refresh Data" trigger: new `ndx refresh --live-server` mode skips the pre-refresh server termination and refuses UI-rebuild plans, and the web dashboard gains POST /api/commands/refresh (+ status poll) with a Refresh Data panel in the Commands view.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The Commands reference no longer marks LLM commands "needs LLM" on projects without an explicit `llm.vendor`: the manifest now mirrors the CLI's own default (absent vendor resolves to claude), so plan/recommend/add/work/self-heal/pair-programming show as available on any initialized project.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Commands-reference rows now match what their Run buttons actually do: the plan row is read-only (its trigger ran only the rex step, not the full plan pipeline), refresh's description states the trigger uses --data-only, ci gains a Run trigger with status polling, and analyze no longer declares a status endpoint its synchronous quick run never uses. rex fix/reshape remain deliberately Validation-view actions.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard command triggers (refresh, ci, auth, self-heal, export) now resolve the ndx CLI on analyzed projects that aren't the n-dx monorepo: cli.js advertises its own path to child processes via `N_DX_CLI_PATH`, and the server's resolver tries the project-local bin, that env path, and `@n-dx/core/cli.js` from its module graph before the monorepo dogfood fallback.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Overview Next Steps panel now matches the page's section styling (its classes previously had no CSS), adds per-item copy and copy-all-as-markdown controls, and gains a confirm-guarded "Capture to PRD" action backed by a new `POST /api/rex/capture-next-steps` endpoint that dedups findings by normalized title and files them as features under a "SourceVision Next Steps" epic.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `usePanZoom` producing a non-finite viewBox when its element measures zero.
  
  Every gesture in the hook converts screen pixels into user-space units by dividing by the element's measured box, so a zero-sized box makes the scale `Infinity` — and `NaN` wherever the delta is also zero, since `0 * Infinity` is NaN. An ordinary vertical scroll has `deltaX: 0`, so the common case produced `NaN -Infinity 400 300`: that value goes straight into the rendered viewBox attribute, and because the bad value is *stored*, the surface stays broken after the element is sized again.
  
  Zero-sized is narrower than it sounds — a `display:none` element cannot receive the event at all — but it is reachable: a container mid-collapse (this codebase animates exactly that in the codebase-map transition), a drag that begins while the element is sized and continues after it collapses, or a first interaction landing before layout settles.
  
  Each handler now returns early when the box is unusable, rather than clamping the scale to something finite. Clamping would keep the gesture alive by inventing a magnitude — panning by a distance derived from an element size that does not exist. Doing nothing leaves the viewBox exactly as it was, and the next event once layout settles behaves normally. The wheel guard sits after `preventDefault` so a zero-sized surface still swallows the wheel instead of suddenly scrolling the page mid-animation.
  
  The guard also covers the ctrl+wheel zoom branch, which divides by the same box for its cursor focal point. The hook previously had no test coverage at all; it now has nine, half of them pinning the normal-path arithmetic at two different element-to-viewBox ratios so the divisions are asserted rather than only the guard.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Pass-gated SourceVision views (Architecture P2, Problems P3, Suggestions P4) are now navigable before their data exists: the sidebar no longer disables locked tabs, and each locked view shows an unlock page with two actions — run enrichment up to just the pass that view needs, or run the full analysis (all passes). Backed by a new `sourcevision analyze --target-pass=<N>` flag and a `targetPass` option on `POST /api/commands/sv-analyze` (async with status polling, like full runs).

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - New Requirements view (REX → Requirements) consuming the previously UI-less requirements API: coverage stats with category/validation/priority breakdowns and an expandable requirement → item traceability matrix with per-item status — the human surface for rex verify / verify_criteria.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the dashboard Reshape preview always reporting "no proposals": the server now spawns `rex reshape --format=json --quiet` so stdout is pure JSON (info() progress prose no longer breaks the report parse), and `rex reshape --format=json` emits a JSON report (`proposals: []`) instead of prose when no proposals are found.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Restore the orphaned Zones and Analyze & Import views into dashboard navigation: zone drill-down returns as a SourceVision tab, and the rex analysis/proposal-review workspace (smart add, batch import, project scan) gets a REX sidebar entry.

- [#324](https://github.com/en-dash-consulting/n-dx/pull/324) [`e35c1c1`](https://github.com/en-dash-consulting/n-dx/commit/e35c1c1f86ed2a831b039acc906b3431d5c1d3e1) Thanks [@en-drza](https://github.com/en-drza)! - Add sample app installation feature with dashboard tutorial and optimize CLI resolution path

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal can be stopped from the dashboard. The web server exposes `POST /api/commands/self-heal/stop`, which kills the managed loop process (SIGTERM) and reports it as stopped rather than failed. The Self-Heal panel shows the current iteration and phase parsed from loop output, with a Stop button while it runs.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal and n-dx workflow visibility in the dashboard. The dashboard can now run and observe the full n-dx flow: self-heal with live iteration/phase progress and a stop control, full sourcevision analysis with async progress, rex fix/reshape/CI actions with dry-run previews, a Commands reference with inline run triggers, and views for the previously UI-less requirements, adaptive-optimization, and activity-log APIs. Command references throughout the dashboard and hench prompts resolve from the project's detected CLI name.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Text boxes on the General and "n-dx analyze / plan" settings pages now match the Analyze & Import input box (surface background, radius, padding, accent focus ring). Also repairs two invalid declarations left by the token remap (`var(--bg))` backgrounds and a mangled active-vendor-card background) that made inputs render transparent.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The General and "n-dx analyze / plan" settings pages now use the shared dashboard styling: their stylesheets were written against an undefined token vocabulary (--color-*/--spacing-*), leaving most declarations inert — all 163 usages are remapped to the real theme tokens, and the Save/Discard buttons now use the standard cmd-btn variants.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard jobs that write `.sourcevision/` — analysis (quick, targeted, and full), refresh, and CI — now share one write lock: starting any of them while another runs returns 409 naming the in-flight job, instead of letting two writers corrupt the analysis output. The previously unguarded quick-analysis path is covered too.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Standardized the Rex Analysis and Hench Optimization pages to the shared dashboard UI systems: the previously fully-unstyled Hench Optimization page now uses cmd-btn buttons, stat-grid/stat-card stats, a data-table preview, filter-select, and view-header conventions with a new per-view stylesheet; the Rex Analysis page header and its Smart Add / Batch Import / Project Scan action buttons now use the standard cmd-btn variants (identity classes preserved).

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard job progress now streams while commands run: full/targeted sourcevision analysis, data refresh, and self-heal spawn through `spawnManaged` with a new `onStdout` chunk callback, so status endpoints expose live output, refresh phases, and self-heal iteration progress mid-run instead of only after exit. The `signal` option briefly added to the buffering `exec` is removed — `spawnManaged.kill()` covers cancellation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface the remaining sourcevision capabilities in the dashboard: a Next Steps recommendations panel on Overview (GET /api/sv/next-steps), an Archetype column with override control in the Files tab (GET /api/sv/classifications, POST /api/sv/archetype), and public exports of deriveNextSteps/setArchetypeOverride consumed through the web sourcevision gateway.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The SourceVision Overview gains a "Full analysis" trigger that runs all four enrichment passes as a background job (202 + status polling with progress), unlocking the Architecture, Problems, and Suggestions tabs from the dashboard; quick re-analyze is unchanged.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Close the remaining small coverage gaps: a new Activity view (REX → Activity) renders the PRD execution log with event filtering and search, Settings → General gains a credential status chip backed by `ndx auth`, the Runs view gains a token-reporting validation trigger, and the Export panel gains a PDF report control. A facet distribution view was scoped and deliberately skipped — facets are MCP-only and unconfigured in practice; the rationale is recorded in docs/cli-ui-gap.md.

- [#318](https://github.com/en-dash-consulting/n-dx/pull/318) [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(token-usage): report actual token usage broken out by type (input/output/cache-write/cache-read), consistently in rollup and dashboard ([#294](https://github.com/en-dash-consulting/n-dx/issues/294))
  
  The per-item rollup summed cache tokens into a single conflated total (~23M for a run whose real work was ~40K), while the dashboard Usage page counted only input+output — a ~575× divergence for the same runs. Rather than pick one number, both surfaces now report the actual usage broken out by type, with no cost/pricing math.
  
  - **rex:** `ItemTokenTuple` now carries `input`, `output`, `cacheCreation`, `cacheRead`, and `total` (= their sum). `tokensFromRecord`, self/descendant attribution, and the ancestor roll-up track all four components; `get_token_usage` surfaces the breakdown.
  - **web:** the Usage-page extractor reads `cacheCreationInput`/`cacheReadInput` from run records (previously dropped), surfacing cache-write and cache-read as distinct fields and attributing run-level cache totals without double-counting across turns. `incremental-task-usage` uses the same breakdown, so the dashboard and rollup report identical numbers for the same runs.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Typecheck test files: `tsconfig.test.json` adds `tests/` to the program and `pnpm typecheck` now runs it, so test-only type errors (and syntax errors) fail the same gate as source instead of surfacing only at vitest transform time.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the dashboard's token-usage aggregation from missing a same-length run-file rewrite.
  
  `IncrementalTaskUsageAggregator` decided whether a run file had changed by comparing mtime + size. On Windows that misses a whole class of edit: file timestamps advance in ticks rather than continuously, so a rewrite of the same LENGTH inside one tick leaves both values identical. Measured on NTFS — 163 of 200 back-to-back same-size rewrites produced a byte-identical `mtimeMs`, with gaps between consecutive distinct mtimes running up to 10ms. An equal-length edit to a run record (a taskId or status swap) therefore kept its old contribution, leaving tokens attributed to the wrong task until some later change to that file forced a re-read. ext4 records nanoseconds, which is why Linux never showed it.
  
  mtime is now trusted only once it is older than a granularity bound. Inside that window the snapshot also carries a hash of the file's bytes and detection compares that instead; the hash is dropped as soon as the mtime ages out, so the steady state stays stat-only — a file is hashed for the scan or two after its last write and never again. Hashing unconditionally would have closed the same hole while defeating the point of an incremental aggregator.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The Validation view gains repair, verification, and restructuring actions: Fix issues (`rex fix`, dry-run preview then apply, followed by automatic re-validation), Run CI check (`ndx ci`, async with structured JSON results), and Reshape PRD (`rex reshape`, previews proposals and applies only on explicit confirm). Backed by new /api/commands/{fix,ci,reshape} endpoints.

- [#334](https://github.com/en-dash-consulting/n-dx/pull/334) [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Security and modernization pass over all dependencies. Resolves all 45 `pnpm audit` findings (2 critical, 16 high) via updated direct dependencies and refreshed pnpm overrides (hono, @hono/node-server, fast-uri, ip-address, js-yaml, nanoid, postcss, qs, vite, ws, body-parser). Modernizes major tooling: TypeScript 6.0, vitest 4.1.10, ink 7, ora 9, jsdom 30, esbuild 0.28, @modelcontextprotocol/sdk 1.30, @anthropic-ai/sdk 0.117, changesets 3. Raises the supported Node.js floor from 18 to 22 (Node 18 and 20 are both end-of-life; CI already runs Node 22).

- [#321](https://github.com/en-dash-consulting/n-dx/pull/321) [`231c72f`](https://github.com/en-dash-consulting/n-dx/commit/231c72f38b17d329a2eabdba9940fb0e9799b949) Thanks [@endash-shal](https://github.com/endash-shal)! - WCAG AA accessibility: fix color contrast ratios, add prefers-reduced-motion support, and add non-color status indicators.
  
  **Color contrast fixes (tokens.css):**
  - Light mode: `--text-muted` #8b90a8→#6b6e88 (2.9:1→4.6:1), `--accent` #008f60→#006E4E (3.7:1→5.6:1), `--green` brand-green→#006E4A (2.2:1→5.6:1), `--orange` brand-orange→#B03800 (2.7:1→5.4:1), `--red` brand-rose→#B01A54 (fail→5.9:1)
  - Dark mode: `--text-muted` #6b7094→#868aaa (3.7:1→5.3:1), `--red` brand-rose→#f55574 (3.4:1→4.9:1)
  
  **Prefers-reduced-motion support** added to badges.css, graph.css, hench-runs.css, prd-tree.css, zone-slideout.css, neolithic-overlay.css, components.css.
  
  **Non-color indicators:** Hench run status in list cards and detail title now shows icon + text label via `.status-badge`. Zone health in overview now shows dot + "Good"/"Fair"/"Poor" text label.
  
  Palette reference added at `src/viewer/styles/PALETTE.md`.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the dashboard "Refresh Recommendations" action so it reliably surfaces its result. `rex recommend --format=json` emits a JSON array, but the `/api/commands/recommend` handler spread it into an object (`{ ok: true, ...parsed }`), turning the recommendations into numeric-keyed props and dropping the count. The client then discarded the response entirely and only showed a bare "Done". The handler now returns `{ ok: true, recommendations: [...], count: N }` (with the non-JSON fallback preserved), and the Suggestions view reports the real count ("N recommendations found" / "No new recommendations") instead of a no-op confirmation.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Zones graph: sort cross-zone-connecting files above internal-only files in expanded zone boxes (and nested sub-zone rows), so bridging files are not hidden by the 15-row cap, and add a per-zone "connecting only" toggle that filters the file list to cross-zone files.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Add unit tests for `buildFileConnectionMap` — the per-file cross-zone connection map behind the Zones graph file rows. Covers bidirectional call-edge connections with weight accumulation, exclusion of same-zone/unresolved/unzoned edges, external-import mapping (`@n-dx/`-scoped and bare package names, src/-preferring zone resolution, same-zone skip), and combined call+import weights. `buildFileConnectionMap` is now exported from `viewer/views/zones.ts` for testability, matching its sibling helpers.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Zones graph: hovering a cross-zone connecting file row now shows a tooltip listing each target zone name and its call weight (sorted by weight descending), resolved from the rendered zone list. Files with no cross-zone links show no tooltip.
- Updated dependencies [[`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056), [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328), [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d)]:
  - @n-dx/llm-client@0.5.0
  - @n-dx/rex@0.5.0
  - @n-dx/sourcevision@0.5.0

## 0.4.6

### Patch Changes

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix the import-graph zone map not filling its block when many boundaries are listed. The codebase-map cell used `align-items: start`, so it stayed at the SVG's natural height while the "Busiest boundaries" strip grew with its (uncapped) list, leaving a gap beneath the map. The grid now stretches the map cell to the row height and the SVG flexes to fill it, and the boundary list is capped (`max-height` + scroll) so a project with many cross-zone boundaries no longer stretches the whole block tall.

- Updated dependencies [[`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352), [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a), [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482), [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99)]:
  - @n-dx/sourcevision@0.4.6
  - @n-dx/llm-client@0.4.6
  - @n-dx/rex@0.4.6

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- [#240](https://github.com/en-dash-consulting/n-dx/pull/240) [`7dc2319`](https://github.com/en-dash-consulting/n-dx/commit/7dc231981c78861a0ab5b3e4cefee1e940d474ea) Thanks [@endash-shal](https://github.com/endash-shal)! - pipeline testing fix

- Updated dependencies [[`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f), [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b)]:
  - @n-dx/sourcevision@0.4.5
  - @n-dx/llm-client@0.4.5
  - @n-dx/rex@0.4.5

## 0.4.4

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.4.4
  - @n-dx/sourcevision@0.4.4
  - @n-dx/llm-client@0.4.4

## 0.4.3

### Patch Changes

- [#229](https://github.com/en-dash-consulting/n-dx/pull/229) [`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0) Thanks [@dnaniel](https://github.com/dnaniel)! - Republish via npm Trusted Publishing. 0.4.2 was bumped in source but never
  made it to the registry because the original NPM_TOKEN-based publish in
  the Release run for [#227](https://github.com/en-dash-consulting/n-dx/issues/227) returned E404. Workflow now uses OIDC; this
  changeset moves all six packages to 0.4.3 so they get published with
  provenance attestation.
- Updated dependencies [[`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0)]:
  - @n-dx/llm-client@0.4.3
  - @n-dx/rex@0.4.3
  - @n-dx/sourcevision@0.4.3

## 0.4.2

### Patch Changes

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix dashboard proposal acceptance silently dropping items. The
  `/api/rex/proposals/accept` and `/api/rex/proposals/accept-edited`
  handlers wrote new items via `savePRD` — which targets the legacy
  `prd.md` + ephemeral cache — instead of the folder tree
  (`.rex/prd_tree/`), the authoritative PRD surface per CLAUDE.md. The
  folder-tree watcher then rebuilt the cache from the unchanged tree, so
  accepted epics/features/tasks vanished with no error. Both handlers
  now write through `resolveStore().addItem()` and refresh the cache
  from the store so the dashboard sees the new items immediately.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Redesign the Hench Runs view so the run history is the focus. The four
  operational diagnostic panels (concurrency, memory, WebSocket health, throttle)
  that previously stacked above the run list now live in a collapsed "System
  status" drawer at the bottom, and the WebSocket health panel — previously
  rendered with no CSS — is now styled to match the other panels.

- [#206](https://github.com/en-dash-consulting/n-dx/pull/206) [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e) Thanks [@endash-shal](https://github.com/endash-shal)! - Rework the PRD context graph, harden the hench run loop, and add LLM auto-failover.

  **PRD context graph (web)** — Top-down progressive-disclosure layout with folder-tree
  visual style; shape-based nodes for epic/feature/task/subtask; click-through opens the
  Rex task detail panel with subtree highlighting. Hierarchy is now driven from
  `.rex/prd_tree/` paths.

  **Hench run loop** — Per-task attempt tracking, completed tasks excluded from
  selection, and the loop advances immediately on success. The `no-plan-mode` rule is
  embedded in the agent system prompt; autonomous runs (`--auto` / `--loop` /
  `--epic-by-epic`) default to `acceptEdits`. New
  `docs/contributing/run-loop-invariants.md`.

  **LLM auto-failover** — New `llm.autoFailover` flag with vendor-specific failover
  chains; `hench run` restores the original config after a failover attempt. Model
  resolution honours top-level `llm.model` → `llm.{vendor}.model` → tier default.

  **Rex storage** — PRD tree rewritten to canonical `index.md`-per-folder layout with
  single-child compaction and atomic leaf-to-folder promotion for subtasks. Timestamped
  snapshots before structural migrations; cross-PRD duplicate detection in `reshape`.

  **CLI / DX** — New `ndx tree` command and tree-formatted `rex status`; `ndx self-heal`
  gains a pre-execution approval gate with `selfHeal.autoConfirm`. Obfuscated-code commit
  blocker added.

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - PRD tree row decluttered. The Token Usage cell is now gated on the
  `showTokenBudget` feature flag (no more noisy column on every row when
  budgets aren't active). Duration and timestamp are removed from the
  row — both still live in the task detail flyout. The level badge
  (`EPIC` / `FEATURE` / `TASK` / `SUBTASK`) now renders only on the
  first item of each contiguous same-level group, so it reads as a
  section header for that indentation instead of repeating on every
  row. Status remains an icon-only indicator with the full label on
  hover.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix two Tasks-view bugs: Quick Add now persists `acceptanceCriteria` on
  accepted task proposals (it was dropped client-side in both the direct-accept
  and proposal-editor paths), and the dashboard "Start Task" button now launches
  an autonomous hench run for the task via `/api/hench/execute` instead of merely
  flipping its status to in_progress.

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - Smart-add fixes — nesting, dashboard Quick Add, and clearer errors.

  **Nesting (rex):** `n-dx add` no longer creates a duplicate epic when the work
  belongs under an existing one. The LLM was supposed to set `existingId` for
  placement under an existing epic/feature but often omitted it. Added a
  deterministic post-generation pass that matches proposed epics/features
  against existing PRD containers (high-confidence, title-based) and fills
  `existingId` so the new task nests instead of duplicating. Respects an
  `existingId` the LLM already set; skipped when an explicit `--parent` is
  given.

  **Dashboard Quick Add latency (rex + web):** new `--fast` flag for `rex add`
  forces the vendor's light tier (haiku for Claude, gpt-5.4-mini for Codex) so
  the CLI provider completes well within the timeout from a daemonized server.
  The web Quick Add preview now passes `--fast`; the user-driven CLI
  `n-dx add` is unchanged.

  **Timeout error message (web):** the smart-add timeout no longer wrongly
  implies "set an API key" is the fix — the Claude CLI provider is a valid
  first-class path. The message now points at the right diagnostic
  (`time claude -p`), notes an API key is only an optional speed-up, and
  appends captured stderr when present.

- [#211](https://github.com/en-dash-consulting/n-dx/pull/211) [`d85139f`](https://github.com/en-dash-consulting/n-dx/commit/d85139fab48b4ad66d5b6b1619243b505b96f0fc) Thanks [@dnaniel](https://github.com/dnaniel)! - SourceVision zone-pin determinism, analyze stability, and Map UX.

  **SourceVision** — Stop spurious enrichment-pass resets on a no-op `analyze`
  (partition-independent input fingerprint reused when code/config is unchanged).
  Zone pins whose target zone did not form are no longer silently dropped — a
  grouped warning finding is emitted (issue [#210](https://github.com/en-dash-consulting/n-dx/issues/210), part 1). New
  `sourcevision.zones.anchors` config declares a named zone from a file glob that
  is forced to exist, making single-target pin consolidations deterministic
  across runs (issue [#210](https://github.com/en-dash-consulting/n-dx/issues/210), part 2). `.rex/` and `.hench/` are excluded from the
  file inventory so generated PRD markdown / run logs no longer skew Overview
  language stats.

  **Web** — Codebase/Zone Map overhaul: deterministic grouped grid layout (no
  overlap), flexbox-centered node labels, cursor-anchored bounded zoom/pan
  (wheel + touch pinch), near-fullscreen File Street View modal, Escape as a
  hierarchical back, and a non-hijacking hover hint. Quick Add now resolves the
  rex CLI from the server's own install (fixes `Cannot find module` for non-n-dx
  projects) with a longer smart-add timeout and an actionable no-API-key error.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Rework the Rex Tasks view status filter and initial state. The status filter is
  now a multi-select dropdown showing per-status counts with "View all" and
  "Pending only" quick actions. On a fresh load the tree defaults to showing only
  pending items when any exist (otherwise all statuses), and the tree now starts
  fully collapsed.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Redesign the Rex Tasks view controls and fix scrolling. Replaces the stacked
  filter UI with a two-row control bar (search + match count + inline actions on
  top, icon-only status pills + tag typeahead below) and collapses the nested
  scroll regions into a single bounded scroller so the task list is the only thing
  that scrolls.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Redesign finding cards. The previous "left-bar + severity-tinted background"
  treatment had two problems: a stray `.severity-warning` rule in tables.css
  was washing entire warning cards in dark orange (orange text on orange
  background — unreadable), and the left-bar-per-card pattern has become an
  AI-dashboard tell. New design:

  - Cards are a single neutral surface — no severity tint, no left bar.
  - Severity reads from a small colored icon + small-caps label on the meta
    row. Color sits on the symbol, not on the entire card.
  - Severity, type, and scope live on one quiet meta line separated by `·`
    instead of three competing badges with their own backgrounds.
  - Body text gets the visual weight: high-contrast, 14 px, generous leading.

  The `tables.css` bare `.severity-*` rules are not touched (they still apply
  to real table cells); `.finding-card.severity-*` overrides them via higher
  specificity so finding-card chrome isn't affected.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Three Graph-view polish fixes:

  - Zone map sizing: the per-zone "Zone Map" SVG was rendering at the full
    container width × (640/980) ratio, which on a wide screen exploded to
    > 1100px tall and ate the whole viewport. Now pinned to its viewBox aspect
    > ratio with a `max-height: min(60vh, 680px)` cap so the map stays the focus,
    > not the page.
  - Outside-click closes File Street View. Previously only Escape or the Close
    button worked; clicking outside the dialog shell now closes it too,
    mirroring conventional modal behavior.
  - Cross-zone edge labels in File Street View are deduplicated. Multiple
    edges between the same source→target zone pair used to stack identical
    "UI Overlays → App-Core Bridge" labels. Now one label per pair, with a
    `×N` count when bundled, positioned at the centroid of the edge bundle.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Zone-view layout polish:

  - On viewports ≥ 1280px, the Current Selection side panel docks to the right
    of the Zone Map instead of stacking underneath, so the map and the
    selection details share the screen instead of forcing a scroll.
  - The Zone Map header "files" stat now shows the selected zone's share of
    the project (e.g. `5 / 102 files`) so the count is anchored to the whole
    codebase instead of reading as an unmoored number.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Three Graph-view polish moves:

  - File Street View hover spotlight. Hovering an edge highlights it and its
    two endpoints; hovering a node highlights every edge touching it and the
    connected nodes; everything else mutes. Cross-zone edge labels show on
    hover even for non-representative edges. A wide invisible hit area on
    each edge makes thin lines forgiving to point at.
  - Remove the redundant per-zone "Map of Zone" header (kicker + zone name +
    zone-only stats) from the in-panel Zone Map. Those stats now live in the
    scope-card up in the codebase-map section as "Zone Name · X/Y files · N
    internal · K in / M out", so they're visible without occupying header
    real estate twice.
  - Wide-screen layout now applies to any `.ig-graph-shell` (not just the
    zone-active variant) so the Current Selection panel docks to the right at
    ≥ 1280px regardless of which view you're in.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - When a zone is active in the Graph view, the masthead metric tiles now show
  _zone-scoped_ numbers (zone files / project files, internal imports, external
  packages used, neighbor zones) instead of repeating the project totals. The
  previous behavior was misleading — "102 files / 115 imports" stayed in the
  hero even when you'd zoomed into a 5-file zone.

  Side-by-side breakpoint lowered to 1100px and reinforced with `!important`
  so the Current Selection panel actually docks to the right on wide screens
  rather than getting silently overridden by the base column layout.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Show the focused file path inline next to the "FILE STREET VIEW" kicker so
  the user always knows which file the dependency graph is centered on without
  hunting for the highlighted node.
- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`d85139f`](https://github.com/en-dash-consulting/n-dx/commit/d85139fab48b4ad66d5b6b1619243b505b96f0fc)]:
  - @n-dx/llm-client@0.4.2
  - @n-dx/rex@0.4.2
  - @n-dx/sourcevision@0.4.2

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

- Updated dependencies [[`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4)]:
  - @n-dx/llm-client@0.4.1
  - @n-dx/rex@0.4.1
  - @n-dx/sourcevision@0.4.1

## 0.4.0

### Minor Changes

- [#198](https://github.com/en-dash-consulting/n-dx/pull/198) [`4de9d46`](https://github.com/en-dash-consulting/n-dx/commit/4de9d46036963129b0e962e1c9aed7e0b9d87262) Thanks [@endash-shal](https://github.com/endash-shal)! - Address security findings, fix package publishing regression, and refresh documentation.

  **Security** — clears 27 of 30 Dependabot advisories:

  - `@modelcontextprotocol/sdk` ^1.25.3 → ^1.29.0 (rex, sourcevision, web) — fixes cross-client data leak via shared transport reuse (GHSA-345p-7cg4-v4c7) plus transitive `hono`, `@hono/node-server`, `path-to-regexp`, `ajv`, and `qs` advisories.
  - `@anthropic-ai/sdk` ^0.85.0 → ^0.94.0 (hench, llm-client) — fixes insecure default file permissions in the local-filesystem memory tool (GHSA-p7fg-763f-g4gf).
  - `vitest` ^4.0.18 → ^4.1.5 (root) — fixes transitive `vite` and `picomatch` advisories.
  - Adds range-scoped `pnpm.overrides` for `picomatch`, `postcss`, `hono`, `@hono/node-server`, `ajv`, `path-to-regexp`, `qs`, and `vite` to pin patched versions in transitive trees the resolver would otherwise leave on older cached versions.

  Audit drops from 11 high / 21 moderate / 2 low to 1 high / 2 moderate. The remaining advisories (rollup, esbuild, vite reached via `vitepress`) are dev-server-only docs-build vulns deferred to a follow-up.

  **Packaging regression guard** — moves `assistant-assets/` under `packages/core/` so it ships inside the published `@n-dx/core` tarball, and adds two e2e tests to prevent recurrence:

  - `tests/e2e/published-assets-bundled.test.js` — asserts `pnpm pack` includes the assistant-assets payload.
  - `tests/e2e/published-package-loadability.test.js` — installs each packed tarball into a clean fixture and verifies CLIs load.

  **Docs** — README, getting-started, and quickstart updates with screenshots in `documentation/` to walk through `ndx init`, `analyze`, `plan`, `work`, `status`, `start`, `ci`, and `self-heal`.

### Patch Changes

- Updated dependencies [[`4de9d46`](https://github.com/en-dash-consulting/n-dx/commit/4de9d46036963129b0e962e1c9aed7e0b9d87262)]:
  - @n-dx/sourcevision@0.4.0
  - @n-dx/llm-client@0.4.0
  - @n-dx/rex@0.4.0

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/sourcevision@0.3.4
  - @n-dx/llm-client@0.3.4
  - @n-dx/rex@0.3.4

## 0.3.3

### Patch Changes

- [#193](https://github.com/en-dash-consulting/n-dx/pull/193) [`700f356`](https://github.com/en-dash-consulting/n-dx/commit/700f356b146864e2aacafd9f0cace42a7942add8) Thanks [@en-drza](https://github.com/en-drza)! - Fix broken external links in the landing page. GitHub links pointed to the old `endash/n-dx` org handle (now `en-dash-consulting/n-dx`) and the npm link pointed to the old unscoped `n-dx` package (now `@n-dx/core`). Updated all six occurrences including the inline security manifest comment.

- Updated dependencies []:
  - @n-dx/rex@0.3.3
  - @n-dx/sourcevision@0.3.3
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- [#189](https://github.com/en-dash-consulting/n-dx/pull/189) [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363) Thanks [@dnaniel](https://github.com/dnaniel)! - Refresh the SourceVision Map experience with cohesive zone/import exploration, remove obsolete Zones navigation, gate PR Markdown behind a feature flag, and dedupe promoted sub-analysis zones.

- Updated dependencies [[`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd), [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363), [`9237f50`](https://github.com/en-dash-consulting/n-dx/commit/9237f509d505659f134f52a9effa6a4f9666fe48)]:
  - @n-dx/rex@0.3.2
  - @n-dx/sourcevision@0.3.2
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.3.1
  - @n-dx/sourcevision@0.3.1
  - @n-dx/llm-client@0.3.1

## 0.3.0

### Patch Changes

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/sourcevision@0.3.0
  - @n-dx/llm-client@0.3.0
  - @n-dx/rex@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/sourcevision@0.2.3
  - @n-dx/llm-client@0.2.3
  - @n-dx/rex@0.2.3

## 0.2.2

### Patch Changes

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/sourcevision@0.2.2
  - @n-dx/llm-client@0.2.2
  - @n-dx/rex@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf)]:
  - @n-dx/rex@0.2.1
  - @n-dx/sourcevision@0.2.1
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.2.0
  - @n-dx/sourcevision@0.2.0
  - @n-dx/llm-client@0.2.0

## 0.1.9

### Patch Changes

- [#106](https://github.com/en-dash-consulting/n-dx/pull/106) [`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82) Thanks [@ryrykeith](https://github.com/ryrykeith)! - ### SourceVision

  - Go language support: import graph analysis, zone detection, route extraction, archetype classification
  - Multi-language project detection (Go + TypeScript coexistence)
  - Database package detection and Architecture view panel (194 known packages across Go/Node/Python)
  - Handler → Database flow tracing in Architecture view
  - Architecture view layout improvements for long Go module paths

  ### Rex

  - Go module scanner (`go.mod` dependency parsing)
  - Go-aware analysis pipeline integration

  ### Hench

  - Go test runner support
  - Go-specific agent planning prompts
  - Go guard defaults in schema

  ### Web Dashboard

  - Database Layer panel in Architecture view
  - Handler → DB Flows panel with BFS path tracing
  - Bar chart label improvements (wider labels, SVG tooltips, smart truncation)
  - Table cell overflow handling for long package names

  ### LLM Client

  - Schema updates supporting Go language constructs

- [#98](https://github.com/en-dash-consulting/n-dx/pull/98) [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Add `withTransaction` API for safe concurrent PRD writes with file locking
  - Add `level` field to `edit_item` MCP tool for changing item hierarchy levels
  - Fix LLM reshape response parsing with action normalization and lenient fallback
  - Fix `--mode=fast` being ignored when `--accept` is passed to `reorganize`
  - Extract shared archive module for prune/reshape/reorganize
  - Add reorganize archiving (removed items preserved in `.rex/archive.json`)
  - Proactive structure: MCP schema coverage audit test

  ### Hench

  - Show auto-selection reasoning in run header (why task was chosen, skipped counts, unblock potential)
  - Show prior attempt history in task card (retry count, last status)
  - Classify changes in run summary (code/test/docs/config/metadata-only)

  ### Web Dashboard

  - Default to showing all PRD items (fixes blank page for 100% complete projects)
  - Remove redundant StatusFilter, wire status chips to tree visibility
  - Smart collapse: tree starts closed when no active work
  - Hide view-header, promote breadcrumb as page title
  - Show sibling page icons in collapsed sidebar rail
  - Move command buttons (Add, Prune) inline into search row
  - Add filtered-empty state messaging

  ### CLI

  - Surface all package commands through `ndx` (validate, fix, health, report, verify, update, remove, move, reshape, reorganize, prune, next, reset, show)
  - Helpful error when running orchestrator commands on package CLIs
  - Workflow-based `ndx --help` grouping (no package names in primary help)
  - Skip provider prompt on re-init when config exists
  - Unified init status report
  - Branded ASCII art CLI header

  ### Docs

  - New 5-minute quickstart tutorial
  - New troubleshooting guide (7 common issues)
  - Commands reference rewritten by workflow stage

  ### Infrastructure

  - `@n-dx/core` included in release workflow (synced version + auto-publish)
  - `/ndx-reshape` skill for PRD hierarchy restructuring
  - `/ndx-capture` skill updated with automatic parent placement and dependency wiring

- [#109](https://github.com/en-dash-consulting/n-dx/pull/109) [`9c2963f`](https://github.com/en-dash-consulting/n-dx/commit/9c2963fcb95e9e80c4702878c958f486bf5f9fbb) Thanks [@dnaniel](https://github.com/dnaniel)! - ### SourceVision

  - **Zone stability:** Louvain community detection now seeds from previous zone assignments, preserving topology across runs. Files stay in their previous zones unless import structure genuinely shifts.
  - **Zone identity preservation:** Zones with >50% file overlap with a previous zone inherit its ID and name, preventing the LLM from inventing new names each run.
  - **Stability bias:** Synthetic co-zone edges reinforce previous zone membership during Louvain optimization. Configurable weight (default 0.5x median import edge).
  - **Stability reporting:** New `stability` field in zones.json tracks file retention, persisted/new/removed zones, and reassigned files between runs.
  - **Finding category taxonomy:** Findings now carry a `category` field (`structural`, `code`, `documentation`) enabling downstream filtering. LLM prompts request categories; regex heuristic classifies when LLM doesn't provide one.
  - **Finding staleness validation:** Findings referencing deleted/moved files are automatically skipped during `rex recommend`.
  - **Weighted cohesion metrics:** Project-wide averages weighted by zone file count. Zones with <5 files excluded from aggregates (unreliable metrics). Both weighted and unweighted averages reported.
  - **Small-zone merge logging:** Configurable merge threshold with debuggability logging.
  - **Git SHA refresh:** `manifest.gitSha` now updated at analysis start, not just init time.

  ### Rex

  - **Self-heal: exclude structural findings:** `--exclude-structural` flag on `rex recommend` skips zone boundary opinions. Self-heal loop passes it by default.
  - **Self-heal: file-level regression guard:** Progress signals shifted from zone-relative (weighted cohesion) to zone-independent metrics (circular deps, code findings, unused exports).
  - **Zone pin discoverability:** `ndx analyze` suggests zone pins when structural findings detected. `ndx config --help` documents `sourcevision.zones.pins`. `rex recommend` shows pin tip for structural findings.
  - **Workflow split:** Base n-dx workflow in `n-dx_workflow.md` (always updated on init) + user customizations in `workflow.md` (preserved across re-init). Prohibited changes section prevents lint-suppress-only commits.
  - **Stats fix:** Childless features now counted in `get_prd_status` totals.
  - **Config routing:** `sourcevision.*` config keys now route to `.n-dx.json` for zone pin management.

  ### Web Dashboard

  - Zone slideout shows "pinned" badge on files with zone pin overrides.
  - Server augments `/api/sv/zones` response with zone pins from `.n-dx.json`.

  ### CLI

  - Fix release workflow: use bash wrapper script for changeset version command (changesets/action splits on whitespace without a shell).

- [#99](https://github.com/en-dash-consulting/n-dx/pull/99) [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Proactive PRD structure health checks with configurable thresholds
  - Post-write health warnings on `rex add` and `rex analyze`
  - Structure health gate in `ndx ci` (fails below score 50)

  ### Web Dashboard

  - Checkbox multi-select: hover reveals checkbox, click row opens detail panel
  - Remove Edit icon from tree rows (detail panel handles editing)
  - Completion timeline view with date range filters (today/week/month/all)

  ### CLI

  - Fix release workflow: use `npx` for changeset commands (pnpm script resolution bug)

- Updated dependencies [[`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82), [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88), [`9c2963f`](https://github.com/en-dash-consulting/n-dx/commit/9c2963fcb95e9e80c4702878c958f486bf5f9fbb), [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8)]:
  - @n-dx/rex@0.1.9
  - @n-dx/llm-client@0.1.9
  - @n-dx/sourcevision@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [[`e83e960`](https://github.com/en-dash-consulting/n-dx/commit/e83e9601f179855b69d49a3557ce1b29bdc082f9)]:
  - @n-dx/rex@0.1.8
  - @n-dx/sourcevision@0.1.8
  - @n-dx/llm-client@0.1.8
