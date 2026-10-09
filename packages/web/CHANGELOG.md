# @n-dx/web

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
