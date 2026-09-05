# Sample App Audit: `ndx install-sample` / `ndx destroy-sample`

**Date:** 2026-09-04
**Task:** Review the ndx example project
**Scope:** `packages/core/sample-app.js`, the `install-sample` / `destroy-sample` CLI commands, the dashboard Sample App panel (`packages/web/src/viewer/views/commands.ts`, `packages/web/src/server/routes-commands.ts`), and the documentation that references them.
**Method:** Static read of the generator and its wiring, a git-history check of how it landed, and an empirical pass: the sample was installed into a fresh scratch repo and then exercised with `ndx status`, `ndx validate`, `ndx health`, `ndx verify`, `sourcevision analyze`, a second `install-sample`, and `destroy-sample` alongside a planted user-owned PRD item.
**Purpose:** Input for the follow-up story "Improve/enhance the ndx example project". This document is review-only; no code was changed on this branch.

---

## 1. What the sample project is today

The "example project" is not a checked-in directory. It is a **generator**: `ndx install-sample [dir]` writes a three-file vanilla web app plus a small PRD subtree directly into the target project, and `ndx destroy-sample [dir]` removes them again. It shipped in `@n-dx/core` 0.5.0 via PR #324 ("Feat/sample-app-drza") and has not been touched since.

### 1.1 Inventory

| Piece | Location | Notes |
|-------|----------|-------|
| Generator | `packages/core/sample-app.js` (257 lines) | HTML, CSS, and JS templates are inline string constants; PRD frontmatter is hand-rolled by `generatePrdMarkdown()` |
| CLI wiring | `packages/core/cli.js` (dispatch map), `packages/core/help.js` (summary + keywords, listed under SETUP) | No detailed per-command help block |
| Dashboard | `InstallSamplePanel` in `packages/web/src/viewer/views/commands.ts`; `GET /api/commands/sample-status`, `POST /api/commands/install-sample`, `POST /api/commands/destroy-sample` in `routes-commands.ts` | Server spawns the ndx CLI; installed-state is `existsSync(<project>/sample-app)` |
| Docs | `README.md` "Quick Start / Try the Sample App", `docs/guide/commands.md` (one table row each), `docs/cli-ui-gap.md` | Not mentioned in `docs/guide/quickstart.md`, `getting-started.md`, or `onboarding.md` |
| Tests | none | No unit, integration, or e2e test references `install-sample`, `destroy-sample`, or `sample-app.js` |

### 1.2 What gets written

```
<target>/
├── sample-app/
│   ├── index.html        # static page: heading + counter + Increment button
│   ├── style.css         # CSS custom properties, single light theme
│   └── app.js            # 12 lines; deliberate bug: count = count + "1"
└── .rex/prd_tree/
    └── sample-app-improvements/                 (epic, in_progress)
        └── interactive-elements/                (feature, in_progress)
            ├── fix-counter-bug/index.md         (task, pending)
            └── add-dark-mode/index.md           (task, pending)
```

Every item carries `tags: [sample-app]`; the destroy command uses that tag as its removal marker.

### 1.3 Intended user journey

README quick start: `ndx install-sample .` → `ndx start .` → open the dashboard → let the agent fix the counter bug → `ndx destroy-sample .`. The CLI and dashboard "Next Steps" text instead say `ndx status` then `ndx work --auto`.

---

## 2. Strengths

- **Zero-friction entry point.** One command, no LLM call, no network, sub-second. A user with no project of their own gets a PRD tree they can immediately browse with `ndx status` or the dashboard.
- **The seeded bug is a good teaching case.** String concatenation in a counter is obvious once seen, trivially verifiable by a human, and small enough that an autonomous agent should fix it in one run. The second task (dark mode) is a plausible feature-sized follow-up that exercises CSS variables already present in `style.css`.
- **Clean lifecycle story.** Install and destroy are symmetric, both work from the CLI and the dashboard, and the dashboard reflects installed state with a status pill and disables the inapplicable button.
- **Correct storage target.** The generator writes to the folder tree (`.rex/prd_tree/`), which is the sole writable PRD surface, and uses slugs that match the serializer's current title-only rule. `ndx status`, `ndx health` (94/100), and the PRD-schema check in `ndx validate` all accept the generated items.
- **Fits the architecture rules.** `sample-app.js` lives in the orchestration tier and imports nothing from domain packages; the dashboard route spawns the CLI rather than importing the generator, matching the spawn-only rule.
- **Discoverable.** `ndx help` lists both commands under SETUP with sensible keywords (`demo`, `example`, `playground`), and the README leads with the sample.

---

## 3. Findings

Severity: **High** = data loss or a broken advertised path. **Medium** = the sample fails to demonstrate what it claims, or the experience is confusing. **Low** = polish and maintainability.

### F1 — `destroy-sample` deletes unrelated user PRD items (High)

`handleDestroySample` walks the whole tree and removes any `.md` file where `content.includes("sample-app") && content.includes("tags:")`. It matches the substring anywhere in the file, not the tag list.

**Repro (performed):** installed the sample, added a user epic `my-real-epic/index.md` with `tags: [frontend]` and the description "Port the sample-app counter into the main product", then ran `destroy-sample`. Output reported five removals; the user epic was gone.

Any item whose title, description, or body mentions "sample-app" and which has a `tags:` key is silently destroyed. Since the whole point of the sample is that the user later works on it and writes notes about it, this is a likely path, not an edge case. The dashboard's Destroy button adds no confirmation step.

### F2 — The advertised quick start does not reach `ndx work` (High)

Neither the README quick start nor the CLI/dashboard "Next Steps" run `ndx init`. `install-sample` itself does not initialize the project. Consequences observed on a fresh directory:

- `ndx status` works but prints "Project setup incomplete — run ndx init" and titles the PRD "PRD" (no `.rex/config.json`).
- `ndx validate` fails: `✗ config.json schema ENOENT`.
- `ndx verify` aborts: `[NDX_CLI_NOT_INITIALIZED] Rex directory not found`.
- `ndx work --auto`, the headline next step, is guarded by `requireInit(dir, [".rex", ".hench"])` plus an explicit vendor check, so it stops before doing anything.

The path "install → start → let the agent fix the bug" therefore requires the user to discover `ndx init`, pick a provider and model, and configure credentials on their own. The dashboard's setup wizard can trigger init, but nothing in the sample flow points at it.

### F3 — Generated PRD items are not schema-clean (Medium)

- Epic and feature are written as `in_progress` with no `startedAt`; `ndx validate` flags both as "stuck tasks". Items should be `pending` or carry a timestamp.
- No `priority`, `source`, or `loe` on any item, so the dashboard's priority ordering, facets, and effort views have nothing to show.
- The body is a hand-written `⚪ [pending]` line plus a `## Summary` section rather than what the rex serializer emits. The parser tolerates it, but the first real save rewrites it, so the sample looks different before and after the agent's first run.
- The tree root `index.md` stub that `rex init` creates is absent when the sample is installed first.
- The generator bypasses rex entirely. Every future change to the folder-tree contract (the schema doc and the serializer already disagree on slug suffixing) is a latent break that no test would catch.

### F4 — Install is not idempotent and has no installed-state guard (Medium)

Running `install-sample` a second time silently overwrites the four `index.md` files with fresh UUIDs (confirmed: epic id changed between runs). Any hench runs, token attribution, or execution-log entries recorded against the old IDs become orphans. The CLI does not detect an existing install; only the dashboard button is disabled, and only based on whether `sample-app/` exists.

### F5 — The codebase is too small to showcase sourcevision (Medium)

`sourcevision analyze` on the installed sample inventories **one file, 12 lines** (`app.js`); `index.html` and `style.css` are not indexed. Result: one zone, zero import edges, zero components, and a single finding that the only zone "contains 100% of project files — may be too broad". The onboarding guide's promised experience (zone map, import graph, component catalog, CONTEXT.md worth reading) is empty for the sample. The isometric map (`ndx iso`) would render a single node.

### F6 — Nothing for verification or the agent to lean on (Medium)

- No `package.json`, no test runner, no tests, no README inside `sample-app/`. `ndx verify` (acceptance criteria → test files) can map nothing, and hench has no command to run to prove the counter is fixed.
- The acceptance criterion "Styling is consistent across themes" is on the feature before dark mode exists.
- With no `.sourcevision/` output at install time, the agent brief has no project context to append.

### F7 — Too little PRD variety to demonstrate rex (Medium)

Two pending tasks under one feature under one epic. There are no `blockedBy` dependencies, no priorities, no subtasks, no requirements, no completed or failing history, and no second epic. `get_next_task`, priority ordering, dependency resolution, facets, `reorganize`, `health` trends, `usage`, and the status timeline all have nothing meaningful to show.

### F8 — No test coverage (Medium)

No test exercises install, destroy, the generated frontmatter, the dashboard routes, or the `sample-status` endpoint. F1 and F3 would both have been caught by a single round-trip test (install → load via rex store → validate → destroy → assert only tagged items removed).

### F9 — Documentation and guidance are thin and inconsistent (Low–Medium)

- The sample is absent from `docs/guide/quickstart.md`, `getting-started.md`, and `onboarding.md`, which are the pages a new user actually lands on; it appears only in the README and a one-line table row in `commands.md`.
- The README says "install → start", the CLI says "status → work --auto"; neither mentions `init`, `analyze`, or `plan`.
- `ndx help install-sample` has no detailed help (usage, what is written, what destroy matches on).
- Dashboard copy calls it a "dummy PRD", and the "Next Steps" block repeats the incomplete command list.

### F10 — Installs into the user's real project by default (Low–Medium)

`ndx install-sample .` writes the sample epic into whatever `.rex/prd_tree/` already exists, mixing demo items into a real PRD, and drops `sample-app/` at the repo root with no `.gitignore` guidance. There is no option to install into an isolated subdirectory that is itself an ndx project, which would be the safer default for "I just want to try it".

### F11 — Rough first-run edges outside the sample's own code (Low)

On a freshly `git init`ed directory with no commits, `sourcevision analyze` prints `fatal: ambiguous argument 'HEAD'` three times. Not a sample bug, but the sample is precisely the flow that hits it, so it should be considered part of the sample experience.

### F12 — Dashboard panel details (Low)

- Installed state is inferred from the `sample-app/` directory only; a user who deletes the directory by hand but keeps the PRD items sees "not installed" and cannot use Destroy to clean the tree.
- The panel deliberately delays the response by 600 ms per step (about 2.4 s on install) to play an animation.
- Destroy is a one-click irreversible action with no confirmation dialog.

### F13 — Maintainability of the generator (Low)

Templates live as string constants inside a JS module, so editing the sample means editing escaped strings. There is no template directory, no manifest of written files (destroy hardcodes the directory name), and no version marker, so a future richer sample cannot be upgraded or detected.

---

## 4. Improvement opportunities for the follow-up story

Grouped by theme, roughly in the order they pay off.

### 4.1 Safety and correctness (addresses F1, F3, F4, F8)

- Make destroy precise: parse frontmatter and remove only items whose `tags` array contains `sample-app`, or better, record the generated item IDs in a manifest (for example `.rex/.sample-app.json`) and delete exactly those.
- Route PRD creation through rex (spawn `rex add` or a dedicated `rex import`) so the items are always schema-correct and serializer-canonical; drop `generatePrdMarkdown`.
- Start items as `pending` (or set `startedAt`), add `priority`, `source: sample`, and `loe`.
- Guard re-install: detect an existing install and either no-op with a message or require `--force`.
- Add a round-trip test (install → load with the rex store → `validate` clean → destroy → tree unchanged except the sample) and a dashboard route test.

### 4.2 A complete onboarding path (addresses F2, F9, F11)

- Have `install-sample` run or offer `ndx init` when the project is uninitialized, or at minimum print the exact sequence: `init` → `analyze` → `status` → `work`.
- Align README, CLI "Next Steps", and dashboard copy on one sequence, and give `install-sample` a detailed help block.
- Add a "Try it with the sample app" section to `docs/guide/quickstart.md` and link it from `getting-started.md` and `onboarding.md`.
- Consider a `--standalone <dir>` (or default-to-subdirectory) mode that creates an isolated, initialized project so the sample never mixes with a real PRD.
- Make the sample create an initial git commit, or make sourcevision tolerate a commit-less repo quietly.

### 4.3 A richer codebase worth analysing (addresses F5, F6)

- Grow the app to roughly 10–20 small modules with a real import graph: for example a vanilla or Preact counter/todo app split into `state/`, `ui/`, `utils/`, and `api/` layers, so zone detection, the import view, the component catalog, and `ndx iso` all show something.
- Add `package.json` with a test script and a handful of unit tests (one of which fails on the seeded bug) so `ndx verify` maps criteria to tests and hench can run them to prove completion.
- Add a `sample-app/README.md` explaining the seeded defects and what each PRD item expects.
- Seed two or three defects of different kinds (logic bug, missing accessibility attribute, dead code) so sourcevision findings and rex tasks line up.

### 4.4 A PRD that exercises rex (addresses F7)

- Two or three epics, one already partially completed with timestamps so `status`, `usage`, and the timeline have history.
- At least one `blockedBy` dependency, mixed priorities, one task with subtasks, one item with requirements, and one `failing` or `deferred` item with a resolution.
- Acceptance criteria that reference test names in the sample's test suite.

### 4.5 Dashboard polish (addresses F12)

- Confirmation dialog before Destroy, listing the items that will be removed.
- Derive installed state from the manifest rather than the directory, and remove the artificial delay.

### 4.6 Maintainability (addresses F13)

- Move templates to files under `packages/core/sample-app/` and copy them, with a manifest of written paths and a sample version, so future upgrades can be detected and migrated.

---

## 5. Summary

| # | Finding | Severity |
|---|---------|----------|
| F1 | `destroy-sample` deletes unrelated items that mention "sample-app" | High |
| F2 | Advertised quick start skips `ndx init`; `ndx work --auto` cannot run | High |
| F3 | Generated PRD not schema-clean; bypasses rex serializer | Medium |
| F4 | Re-install silently regenerates IDs; no installed-state guard | Medium |
| F5 | One indexed file; sourcevision has nothing to show | Medium |
| F6 | No tests or package manifest; nothing for verify/hench to run | Medium |
| F7 | Two tasks; rex features go undemonstrated | Medium |
| F8 | Zero test coverage of the feature | Medium |
| F9 | Docs and next-step guidance thin and inconsistent | Low–Medium |
| F10 | Installs into the user's real PRD by default | Low–Medium |
| F11 | Git `HEAD` noise on a commit-less first run | Low |
| F12 | Dashboard: no confirm, directory-only state, artificial delay | Low |
| F13 | Inline string templates; no manifest or version | Low |

The sample succeeds as a frictionless first touch and as a symmetric install/destroy demo, and the seeded counter bug is a good teaching case. It falls short as a *starter project*: the codebase is too small for sourcevision to analyse, the PRD too small for rex to demonstrate, the flow never reaches a working agent run without undocumented setup, and the destroy path can delete a user's own work. The follow-up story should treat F1 and F2 as must-fix and use sections 4.3 and 4.4 to define what "enhanced" means.
