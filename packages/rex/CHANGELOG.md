# @n-dx/rex

## 0.9.1

### Patch Changes

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`02aa8af`](https://github.com/en-dash-consulting/n-dx/commit/02aa8afe08842e6d56b65f52d3364007485b72c2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 agent brief is built from the change and the product nodes it affects. `buildChangeBrief` renders the work, the change's intent and amendments (proposed text included), each amended or touched capability with its own and inherited capability criteria, requirements, health and whether its spec was reviewed, the constraints that bind them, depends-on neighbours one hop out, where the capabilities live in code, the last three changes to those nodes, and the project's commands, workflow and log.
  
  One measured 4,000-token budget covers the whole brief. Sections are admitted capabilities-and-constraints first; a list that does not fit is trimmed in place — falling back to a compact form that still names every capability — rather than dropped, and every trim says what it left out. Nothing takes a vendor or model, and the sectioned and flat renders are byte-identical, so a CLI run and an API run send the same brief.
  
  `@n-dx/llm-client` exports `estimateTokens` and `CHARS_PER_TOKEN`, the model-independent half of `budgetPreflight`, so a caller sizing text against its own budget needs no model id.
  
  The two sections the budget never trims, `task` and `change`, bound every free-text field and every list they render — description, failure reason, done-when criteria, tags, blockers, an amendment's summary, proposed text and criteria, and the touched-without-amending list. An unbounded one would not have made the brief long, it would have made the brief exceed its budget and drop the capabilities section the budget exists to protect.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`3049ac5`](https://github.com/en-dash-consulting/n-dx/commit/3049ac5ae0199c06b262d0bec554d0c6931db497) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex change apply`, `add_item` and `place_change` now refuse a criteria delta on a constraint, or a replace/remove on a new capability, with "has no capability criteria" instead of a bare "criteria".

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`f0ca395`](https://github.com/en-dash-consulting/n-dx/commit/f0ca3954254f56bd20611e14459f607dc6181ff9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex health` now says a capability "has no capability criteria" instead of a bare "criteria".

- [#627](https://github.com/en-dash-consulting/n-dx/pull/627) [`8507518`](https://github.com/en-dash-consulting/n-dx/commit/8507518864af56e93cf8a6c2aad6c3bb9a9236a1) Thanks [@dependabot](https://github.com/apps/dependabot)! - Dev dependencies bumped, including vitest 5. No runtime change: the published packages ship the same code, and the one test that vitest 5 rejected (a `vi.mock` written inside a test body) now declares its mock at module scope.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`5ef4660`](https://github.com/en-dash-consulting/n-dx/commit/5ef4660a3d53c49946aa396c54c2dee20af7d920) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex health` on a v2 tree runs the v2 tree rules and reads `rex.structureHealth.maxCriteriaPerCapability` as the capability-criteria threshold. v1 trees report as before.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`17257ac`](https://github.com/en-dash-consulting/n-dx/commit/17257acdcd976fae362ee09488bc2ddebebe2992) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On a v2 tree, `rex health` exits 1 when a tree rule reports an error or the reader skipped a node; warnings alone exit 0. `ndx ci`'s structure-health step gates on that exit code and shows error, warning and skipped-node counts instead of "score: undefined". v1 is unchanged.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`4aae21c`](https://github.com/en-dash-consulting/n-dx/commit/4aae21c613d532b56a3b62fce0f362075110e4fa) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex health` on a v2 tree now prints the reader's warnings under "Reader warnings:" and adds a `warnings` array beside `treeRules` in `--format=json`, so skipped nodes and folders without `index.md` no longer read as "no findings".

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`dc0ba79`](https://github.com/en-dash-consulting/n-dx/commit/dc0ba79f4e48dae6b7d803d201bdcb69602f2023) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 migration plan now holds every cancelled or deleted item as an unapplied change that needs placement, unless its v1 parent already names its capability or constraint: fix- or work-shaped features, tasks under an area, PR-named epics and root-level items. Before, rules could place them on a capability.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`7964dc2`](https://github.com/en-dash-consulting/n-dx/commit/7964dc2f3c762f6f4aa77fc548f94bef3653ed3d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 migration plan now holds a cancelled or deleted child of a release epic as an unapplied change that needs placement, as it already does under areas. Before, rules could place it on a capability as an ordinary change.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`00ba308`](https://github.com/en-dash-consulting/n-dx/commit/00ba308ecb4ae783cdf4837686f3f8338ede1c0e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `draftCapabilitySpecs`, the spec step of the v2 migration plan. For each planned capability it drafts a present-tense statement and EARS-style criteria from the feature and its applied history. A criterion whose words match test file names becomes an automated requirement; a wide tie links nothing. Code evidence from sourcevision is passed in by the caller. A draft leaves `reviewedHash` unset unless the capability is listed as reviewed with that draft's spec hash. A listed capability whose draft changed since approval stays unreviewed, with a note naming both hashes, and joins the review queue. Not wired to a command yet.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`3b4978e`](https://github.com/en-dash-consulting/n-dx/commit/3b4978ec0d50d08b56b93996a565f7cc148efd43) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `classifyV1Tree`, the first step of the v2 migration plan. It reads a v1 item tree and gives every item one entry with a v2 target, writing nothing. An epic naming a PR or issue becomes one change. An epic naming only a release dissolves into `plannedRelease`, and each of its children becomes a change. A release-named epic never becomes an area. Other epics become areas. Under an area, features become capabilities, constraints or changes from their titles, and each change is placed on a capability or constraint only when the placement rules find a clear leader. Otherwise it is held with `needsPlacement`. The plan also proposes the area list, flagging titles that are not job-shaped and areas with no product node, and the constraints. Not wired to a command yet.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`5032a7c`](https://github.com/en-dash-consulting/n-dx/commit/5032a7c9ff4346c62fc8898a32d7183d8cdc3f6d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A release epic the v2 migration plan dissolves no longer becomes an alias of its first child, which sent a lookup of the old id to an arbitrary change. The plan summary lists each dissolved release (`dissolvedReleases`: old id, title, `plannedRelease`) so a lookup of the old id can say what it was.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`5292bdb`](https://github.com/en-dash-consulting/n-dx/commit/5292bdb577c696e8ed05a9a2de2cf42b9d3b13fb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 migration plan reads the caller's `productNames` in a feature title, so another repository's "Acme 2.1 search" feature is a change with `plannedRelease` 2.1 rather than a capability.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`65731af`](https://github.com/en-dash-consulting/n-dx/commit/65731afcf429ea011d2bb1ee4e5f537a6739b0e4) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 migration plan can have Jev review it. Review runs when `rex.placement.models` is `jev` or `both`, or the `jevReview` option is set, and needs a TypeSafe key. Without a key the pass is skipped with one warning. Each item gets one Jev request (task class `prd.migrate.judge`) that batches its questions: a held item's kind and placement, whether an area's title names a job a user does, whether each criterion states product behaviour, and whether each linked test exercises its criterion. Each judged entry records its lowest confidence. The plan summary gains a review queue (held items first, then entries by ascending confidence) and counts of what Jev flagged and dropped. A test link Jev judges irrelevant is dropped only under `autoAccept: confident`. Otherwise it is flagged. A different kind or a process criterion is flagged, never applied. After Jev drops a link, review is re-checked against the approved spec hash, as after any redraft. Migrations may define `summarize`, which rebuilds the summary after every pass.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`8c6112e`](https://github.com/en-dash-consulting/n-dx/commit/8c6112e3182b7d624b8fc2ee6dbb84b411e203f7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 migration plan can place the changes its rules hold with a model. A text pass (task class `prd.place`, on by default) and a Jev pass (when `rex.placement.models` is `jev` or `both` and a TypeSafe key is present) ask about each held change and decide through `decidePlacement`, so `rex.placement.autoAccept` applies as it does elsewhere. A proposed new capability or constraint is never accepted without a person. The plan file records every raw model answer, so a re-plan with a different accept rule does not ask again. With no model available, or `rulesOnly`, the plan is the rules-only plan. Migration passes now receive the plan context, and `merge` may be async. A placement question carries only the rules shortlist's capabilities, so renaming any other capability keeps the recorded answer, and a replay decides as the recording did. Not wired to a command yet.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`e5b9066`](https://github.com/en-dash-consulting/n-dx/commit/e5b90660d44136bc568935a636703065933c7b04) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 migration plan redrafts capability specs with a text model (task class `prd.spec`, on by default through `planSeams`, which replaces `placementSeams`). The model sees only the capability's item, its applied history, its code files and its linked tests. Every criterion cites the item it came from; one citing no source, or an item outside the capability, is rejected and the template criteria are kept with a note. The plan records the answers, so an unchanged re-run does not ask again. The template draft stays as the fallback and is fixed: no "The product provides …" statement (a note asks for one), grammatical EARS for verb-led criteria ("removes dead exports" becomes "The system shall remove dead exports"), process criteria (tests pass, docs updated, changeset added) left out, tests linked only within the packages of the capability's code files, and no `specReviewed` field.
  
  Specs are drafted once placement settles. The plan places held changes with the text model, then with Jev, then drafts the specs, then has the text model redraft them and Jev review them. So an applied change that the text or Jev pass places on a capability is among its sources, and a model criterion citing that change is accepted. Migrations may define ordered `stages`: model stages and deterministic `derive` stages. A model's stages share one recorded-answers map, and an unchanged question still reuses its recorded answer.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`91d20ad`](https://github.com/en-dash-consulting/n-dx/commit/91d20ad509f252d9d17f8128f1f2e5b8f3543609) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The migration plan's Jev review raises a note or flag only for answers at or above a confidence of 0.4 (`jevFlagMinConfidence` in the migration options changes it); weaker answers stay recorded on the entry. The review queue ranks held items first, then entries by number of confident flags, then by confidence, so an undecided answer no longer outranks a confident flag. The summary's flagged counts use the same threshold.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`1ffe0ca`](https://github.com/en-dash-consulting/n-dx/commit/1ffe0cae40b67858122ab14d26cdcb8b934afb22) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Give migrations their own home in `src/migrations/`, so a schema migration can be deleted as a unit. A migration plans from a source adapter rather than a tree type, through a pipeline of rules, then an optional text pass, then an optional Jev pass, each calling an injected seam. It writes a JSON plan file: a header (migration id, source digest, `cutAt`, passes and their models), entries keyed by source item id, and recorded model answers keyed by item id and content hash, so re-planning reuses the answer for an unchanged item. The v1-to-v2 plan modules moved into `migrations/v1-to-v2/` and are registered as the `v1-to-v2` migration. Not wired to a command yet.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`fa4d7e9`](https://github.com/en-dash-consulting/n-dx/commit/fa4d7e903e9a59a3549f98678483b49dceeb6c45) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex reshape --accept` on a v2 tree no longer fails when one product-layer proposal would make the drafted change unappliable, such as a move under an area that another proposal removes. That proposal is reported as not drafted, with apply's reason. The other proposals are still drafted, and the change-layer pass still runs.

- [#627](https://github.com/en-dash-consulting/n-dx/pull/627) [`00e7462`](https://github.com/en-dash-consulting/n-dx/commit/00e74627b65fe3bcc453d4330ef5d9969b82d177) Thanks [@dependabot](https://github.com/apps/dependabot)! - Production dependencies bumped: zod 4, ink 8, react 19.3, @anthropic-ai/sdk 0.131, @modelcontextprotocol/sdk 1.32.1 and pdfkit 0.20. TypeScript stays on 6.x because sourcevision parses source with its compiler API, which TypeScript 7 does not ship, and preact stays on 10.x until its web test and leave-guard changes are worked through. Schemas move to zod 4's two-argument `z.record`; reserved and loosely-typed state keys are declared optional, since zod 4 no longer treats a missing `z.unknown()` key as optional; and the SDLC evidence list keeps its at-least-one rule as a tuple so it still infers the non-empty type.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`039ee0c`](https://github.com/en-dash-consulting/n-dx/commit/039ee0c79a06fb4786790f233b79a1a53628ef4b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex reshape` on a v2 tree now drafts a move or split of a product node whose body holds only the History section `rex change apply` writes; the copy's History names the original's id. Notes outside History still stop the move, with the reason.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`9b5f740`](https://github.com/en-dash-consulting/n-dx/commit/9b5f7404da93f402fb75bae6b0da0556909e63a5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex reshape` on the product layer no longer drafts a merge that would lose data: a merged node with tags, notes outside History, requirements, dependsOn or appliesTo, or one another live node names, is skipped with the reason.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`f0a4b80`](https://github.com/en-dash-consulting/n-dx/commit/f0a4b802eb0e435afea4466de0e5af56cf7b73c3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex reshape`, `rex reorganize` and `rex prune` (consolidation and `--smart`) skip, with the reason, a merge that would fold away an applied change and a split, delete or collapse that would remove a change prune keeps; the rest of the batch still applies. The change-layer store refuses any write that removes a change prune keeps, so a retired product node keeps its status row.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`6e87f37`](https://github.com/en-dash-consulting/n-dx/commit/6e87f37a3943094dcf596e268b28c553be04cf1a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The migration plan treats a completed feature as a fix change, not a capability, when an adversarial review filed it (source, `severity:*` or review tag, or an area with that source) or its title states a defect ("silently", "does not", "never", "cannot", "can … instead of").

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`b05a659`](https://github.com/en-dash-consulting/n-dx/commit/b05a6599554b5d7893b6735f16c01636c573f04d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex health` on a v2 tree now passes the project's releases (package.json version, every `plannedRelease` and `shippedIn`) to the tree rules, so `title-release-token` flags a change titled with one of them. A dependency version that is not a project release is still not flagged.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`4670da7`](https://github.com/en-dash-consulting/n-dx/commit/4670da73c3a43fb2616b0ed5f5d477373fff81e6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex reshape`, `rex reorganize` and `rex prune` are layer-aware on a v2 PRD. The change layer is restructured as on a v1 PRD; nothing under `product/` is written. On the product layer, reshape drafts accepted proposals as one change with removed and added amendments (a move or split that would drop a node's tags, body, requirements or dependsOn, or orphan a reference to it, is reported and not drafted), reorganize only reports, and prune does not apply. v1 trees behave as before.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`0316a48`](https://github.com/en-dash-consulting/n-dx/commit/0316a48dc8cead39507ed79811a0a0fcba6a2775) Thanks [@ryrykeith](https://github.com/ryrykeith)! - New `rex product show|edit` and `rex change place|apply` for a v2 PRD. On a v2 tree `rex add` (and `ndx add`) creates a change, or a task or subtask under `--parent`, and prints it with its suggested placement; a description becomes one change. `--criterion` stays a work item's acceptance criteria; a capability's capability criteria use `--capability-criterion`. v1 trees behave as before.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`23cb6f3`](https://github.com/en-dash-consulting/n-dx/commit/23cb6f36f4c3dcd33713c4201e58a8d5daa15291) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex prune` on a v2 tree keeps applied changes that carry removed or added amendments, so a retired product node keeps its status row. It reports what it kept and why.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`4448fe4`](https://github.com/en-dash-consulting/n-dx/commit/4448fe4bfd8822e722e4548f66e947a3fb91d306) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `rex release stamp <version>`: stamps `shippedIn` on every finished change that has landed on main since the last release tag, reading git only (tags, ancestry, `N-DX-Item` trailers), so any CI can run it. Under `rex.applyOn: release` it first applies completed changes to the product layer. A stamped change is never restamped. On a v1 tree it prints that there is nothing to stamp and exits 0. n-dx's Version Packages step now runs it and continues with a warning if it fails.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`c8c81b2`](https://github.com/en-dash-consulting/n-dx/commit/c8c81b2d3741448f67bafb995134c2706dbd6aab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Spec drafts name the actor and the behaviour: the prompt forbids opening a criterion with "The system shall ensure that" and leaves out decisions, documentation edits and process steps, and a merged "The system shall ensure that the system keeps …" is stored as "The system shall keep …".

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`a23735c`](https://github.com/en-dash-consulting/n-dx/commit/a23735ccadf4deade1eb3280be4da2c9aa8f58e3) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The migration plan keeps a model's own subject in a capability criterion. "The inventory lists every prompt surface" is stored as "The inventory shall list every prompt surface", and a sentence whose verb cannot be converted is stored as written, instead of being wrapped in "The system shall ensure that". The spec-draft prompt now asks for "shall" in every criterion.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`e605e9f`](https://github.com/en-dash-consulting/n-dx/commit/e605e9f3bf02b0d724ea72b7818d2f4533b195bb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The migration plan's present-tense statement check accepts a statement that names "the task", "the change", "the item" or "the PR", or opens with a code span such as "`ndx self-heal` persists …". Those are product vocabulary in a PRD tool; only "this feature/task/change/…" still marks work. Capabilities whose model statement was rejected no longer fall back to the template statement.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`bf98c36`](https://github.com/en-dash-consulting/n-dx/commit/bf98c36b8d80364c2a745ff3d2594349be9fa7ae) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 rule `title-release-token` is now a warning. `rex health` still prints a title that names a project release or a PR, but it no longer counts as a tree rule error, so it cannot fail the command or `ndx ci`. `rex add`, `rex change place` and MCP `add_item` / `place_change` refuse only on errors, so they now also accept a title naming a PR (such as "PR 12 follow-up"), which they refused before. Titles naming a release were already accepted there.

- [#616](https://github.com/en-dash-consulting/n-dx/pull/616) [`844b636`](https://github.com/en-dash-consulting/n-dx/commit/844b63698f9ccda4f81b83362257b16dfcb065c2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex tree-diff` reports the product map delta on a v2 tree: capabilities and constraints added, modified (title, statement or capability criteria) and retired, beside the change list (`map` in `--json`). `--format=markdown` renders the report as a host-neutral pull-request comment, and `--out=<file>` writes it to a file (refused inside `.rex/`). v1 diffs are unchanged.
- Updated dependencies [[`02aa8af`](https://github.com/en-dash-consulting/n-dx/commit/02aa8afe08842e6d56b65f52d3364007485b72c2), [`8507518`](https://github.com/en-dash-consulting/n-dx/commit/8507518864af56e93cf8a6c2aad6c3bb9a9236a1), [`090e111`](https://github.com/en-dash-consulting/n-dx/commit/090e111efc45edac8a0bcdf420fd55b2baabc117), [`65731af`](https://github.com/en-dash-consulting/n-dx/commit/65731afcf429ea011d2bb1ee4e5f537a6739b0e4), [`00e7462`](https://github.com/en-dash-consulting/n-dx/commit/00e74627b65fe3bcc453d4330ef5d9969b82d177), [`e41d31f`](https://github.com/en-dash-consulting/n-dx/commit/e41d31fff91f9599ffc1e85d38cf1fad8da9e162), [`c357d36`](https://github.com/en-dash-consulting/n-dx/commit/c357d364ff0609368c12f8a797e468960fed53f6)]:
  - @n-dx/llm-client@0.9.1

## 0.9.0

### Patch Changes

- [#526](https://github.com/en-dash-consulting/n-dx/pull/526) [`ddd4e15`](https://github.com/en-dash-consulting/n-dx/commit/ddd4e1573f7a1e80c943ffa2875347b9f8b4717c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex add` (smart add) and the dashboard's proposal accept routes now keep `loe`, `loeRationale` and `loeConfidence` on the tasks they create; invalid values are dropped. `rex add` no longer strips the fields while attaching duplicate reasons.

- [#610](https://github.com/en-dash-consulting/n-dx/pull/610) [`572d759`](https://github.com/en-dash-consulting/n-dx/commit/572d759e36c98f7f067e40fb1474f7154792a081) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `add_item` (v2 change with `amends`) and `place_change` (relation `amends`) now dry-run `apply_change` before they store an amendment. If apply would refuse it, they refuse with apply's own message and write nothing. This covers, for example, a criteria delta on a constraint, `criteria.replace` or `criteria.remove` on a capability the same change adds, and criterion ids that do not fit the capability. A summary-only modified amendment (no proposed text and no criteria delta) is refused too: pass proposed or criteria, or use relation touches. A stale `base` is still accepted.

- [#610](https://github.com/en-dash-consulting/n-dx/pull/610) [`8eb093b`](https://github.com/en-dash-consulting/n-dx/commit/8eb093be6652abaeb840e585332eb33b2bf740b0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - MCP `add_item` takes `type` (change, task, subtask) plus `amends`, `touches` and `discoveredFrom` on a v2 tree, where `level` is refused. With no type it creates a change, and a change that neither amends nor touches lands in the Inbox with `needsPlacement`. A task under a completed, applied, cancelled or deleted change is refused (also in core `addTask`), and the error suggests a follow-up change with `discoveredFrom`. `get_item` reads v2 trees. On a v1 tree `add_item` works as before: `level` is now optional in the schema, `task`/`subtask` types stand in for it, and v2-only types and fields are refused naming the v1 layout.

- [#610](https://github.com/en-dash-consulting/n-dx/pull/610) [`536e9a8`](https://github.com/en-dash-consulting/n-dx/commit/536e9a88647bbb57fe6379fd1b36d8b52e755467) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `add_item` (v2 change with `amends`) and `place_change` (relation `amends`) refuse only what `apply_change` would always refuse. A problem that only another open change causes, such as removing a node another open change still amends (`open-change-refs-live`) or whose live descendants another open change removes, no longer refuses: the change is stored and the response carries an additive `warnings` list naming the open change(s) and apply's message. `apply_change` is unchanged and still refuses until that change is applied or closed.

- [#583](https://github.com/en-dash-consulting/n-dx/pull/583) [`c47baa4`](https://github.com/en-dash-consulting/n-dx/commit/c47baa4a12f8428b755bfbf8008a89b2a5e4e589) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 apply engine stamps `appliedAmendsHash` and reports an applied change whose amends were edited afterwards, refuses an amendment whose `base` no longer matches its target's spec (unless forced), refuses a result that breaks a v2 rule the input did not, creates a constraint for an added amendment with `type: "constraint"`, and clears the change's `needsPlacement`. Product-edit drafts record `base`.

- [#583](https://github.com/en-dash-consulting/n-dx/pull/583) [`28f38ab`](https://github.com/en-dash-consulting/n-dx/commit/28f38ab5a520f76ca551c30e544f796521d9cc60) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 apply engine now stamps `appliedAt` (a timestamp the caller passes) instead of `appliedIn`, refuses an already applied change by `appliedAt`, and takes no commit option. A completed but unapplied product-edit draft counts as open, as in the v2 rules.

- [#583](https://github.com/en-dash-consulting/n-dx/pull/583) [`f3694e7`](https://github.com/en-dash-consulting/n-dx/commit/f3694e7cab6d135f3e5bb791c01aa58232dab634) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `rex.applyOn` (`core/apply-policy.ts`), read from `.n-dx.json`: `complete` (default) applies a change when it completes, `review` waits for a steward's explicit apply, and `release` applies at release stamping. A steward's apply runs under every mode; an invalid value falls back to `complete` with a warning. `changesAwaitingApply` lists completed but unapplied changes, which stay open, so their capabilities keep reading changing. Not wired into the store, CLI or MCP yet.

- [#569](https://github.com/en-dash-consulting/n-dx/pull/569) [`c1af698`](https://github.com/en-dash-consulting/n-dx/commit/c1af6987f02b0620edea263c4415fa1219b03d4e) Thanks [@endash-shal](https://github.com/endash-shal)! - Close every known dependency vulnerability ahead of the release.
  
  `pnpm audit` reported two critical and three high advisories. One was reachable from shipped code: `@modelcontextprotocol/sdk` 1.30.0 (GHSA-6qxp-vccf-f47h, an OAuth client that could send credentials to an authorization server the MCP server chooses), a direct dependency of rex, sourcevision and web. It moves to 1.32.0.
  
  The other four are transitive and are pinned with overrides in the same style as the existing ones: `proxy-addr` ≥ 2.0.8 (GHSA-jqcg-44mw-7w3h, IP spoofing — reached from shipped code through the MCP SDK's express), plus three that only ever load in development tooling — `shell-quote` ≥ 1.11.0 (GHSA-pqg4-j6r4-53mv, via `@changesets/cli`) and `vue` ≥ 3.5.42 with `source-map-js` ≥ 1.2.2 (GHSA-g2v6-rqmx-r4w6 and GHSA-68fv-2mgg-jv7q, both via vitepress's docs build).
  
  `pnpm audit` now reports no known vulnerabilities.

- [#605](https://github.com/en-dash-consulting/n-dx/pull/605) [`d1ae043`](https://github.com/en-dash-consulting/n-dx/commit/d1ae043b127dcf49085e408a0c287d50b6cf2a10) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix `rex backfill-commit-attribution` reading only part of a real repository's history.
  
  The command buffered the whole `git log` body in memory through a bare `execFile`, whose 1 MiB default it outgrew — on this repository's own 3.5 MiB history it reported "could not read git history" and did nothing, a silent no-op. It now runs through core's `git` helper, the same path `change-commits.ts` already uses with a 256 MiB ceiling for exactly this reason, so its `node:child_process` entry drops out of the allowlist.
  
  Two parsing gaps surfaced once it could read the log at all:
  
  - **Only the first trailer per commit was read.** A commit that touches several items carries one `N-DX-Status` trailer per item; this repository's 53 such commits carry 122 trailers between them, so better than half were being dropped. Every trailer is now read.
  - **Only the Unicode arrow was matched.** Both `→` and `->` occur in history; the `->` form was skipped entirely.
  
  The body is still scanned rather than handed to git's own `%(trailers:…)` parser, which reads only a message's final paragraph: most of this history puts a blank line between the `N-DX-Status` lines and the closing `Co-Authored-By`, so git classifies them as prose and recognises 3 of the 53 commits. A comment on the parser records that.

- [#588](https://github.com/en-dash-consulting/n-dx/pull/588) [`1dfc0c7`](https://github.com/en-dash-consulting/n-dx/commit/1dfc0c7e7947ffa6054cb6ef9efc214805253a16) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Each package's full build now ends by writing `dist/.build-stamp.json`, a hash of the source it compiled. The repository's affected test gate uses it to tell a current build from a stale one by content rather than by file times, so a partial build no longer hides stale compiled code and an identical-content rewrite no longer demands a rebuild.
   The stamp is excluded from the published tarballs.

- [#589](https://github.com/en-dash-consulting/n-dx/pull/589) [`5399355`](https://github.com/en-dash-consulting/n-dx/commit/53993552706a40311b3caeef53f66be1944b40c0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex export` (`ndx prd export`) on a v2 tree writes bundle envelope v2, carrying the root header and both the product and change layers, each node's `state.yaml` row apart under `state` so a state key this rex does not declare still imports into `state.yaml`, and each `state.yaml`'s own top-level keys other than `schema` and `items` under `folderState`, written back to the same folder's file. The carried root header is validated before anything is written. A v1 tree still writes envelope v1. `rex import-bundle` (`ndx prd import`) accepts both: into a v2 tree a v2 bundle imports whole and a v1 bundle lands in the change layer (its `--replace` replaces that layer only); a v1 tree takes v1 bundles and refuses a v2 one before writing. `--replace` on a v2 tree needs `--no-snapshot`, since `rex restore` covers the v1 tree only. Export still refuses any output path inside the rex directory.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`73bab95`](https://github.com/en-dash-consulting/n-dx/commit/73bab9592b9ceda77239ad83b84b610c7db34f8e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Change-commit lookup defaults to origin/HEAD, then origin/main, then main, so a CI checkout without a local main and a clone with a stale local main both resolve.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`d059e28`](https://github.com/en-dash-consulting/n-dx/commit/d059e284f7c9320e436884d96e3cc3467bc502b0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Change-commit lookup refuses a shallow clone with an error naming `git fetch --unshallow` and `fetch-depth: 0`, instead of returning a truncated commit list.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`0df9e0f`](https://github.com/en-dash-consulting/n-dx/commit/0df9e0fcbb4cd85938301380f4a5a5968a470d5d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A change's landing on main is worked out from git history alone: the first-parent merge commit that carries its `N-DX-Item` trailer commits, or the commit itself when fast-forwarded or rebased. A squash merge reports `landed: false` with the reason. Landings are cached under `.ndx/rex/.cache`. `shippedIn` falls back to the first release tag containing the landing commit when no stamp exists.

- [#518](https://github.com/en-dash-consulting/n-dx/pull/518) [`b73b061`](https://github.com/en-dash-consulting/n-dx/commit/b73b06162cb210705583e6846f2349de8901c85d) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the mechanical paths deterministic, and stop re-reading the PRD tree.
  
  Two LLM/agent round trips that were doing work code can do exactly, and four
  places where the PRD folder tree was read or written more times than once.
  Measured on this repository's own PRD: 431 item directories, 1,853 files,
  8.3 MB.
  
  **Deterministic pre-run commit subject** (`hench.git.commitMessage`). The
  pre-run commit gate asked a light-tier model for a one-line subject
  summarising the operator's *pre-existing* uncommitted changes, and
  `commit-subject.ts` existed to strip the preambles and fences that came back
  before the text reached `git commit -m`. The subject is now computed from the
  dirty file list — `chore(rex,web): pre-run checkpoint, 12 files, 340 lines` —
  with the conventional-commit type inferred only where the file list proves it
  (`docs`, `test`, else `chore`; never `feat` or `fix`, which are claims about
  intent). This also replaces the fixed `"chore: commit local changes before
  hench run"` that every failed model call fell back to. Set
  `hench.git.commitMessage: "llm"` to restore the model.
  
  **No duplicate `in_progress` write** (`hench.promptAgentToMarkInProgress`).
  The API-path prompt told the agent to mark its task `in_progress` via
  `rex_update_status`, but hench already made that transition before the agent
  starts (`transitionToInProgress`, both loops). The step cost a tool round
  trip and a second write of a value already on disk, which also left
  `.rex/prd_tree/` dirty ahead of the uncommitted-work gate. The *completion*
  step is unchanged and not comparable: that call is a request rex parks on the
  task claim rather than a PRD write, and it carries the `resolutionType` and
  `resolutionDetail` hench applies once the test gate passes.
  
  **Faster folder-tree parse** (no flag; output is byte-identical). The parser
  issued a `readdir` for each of the four scans a directory gets and a `stat`
  per entry to find subdirectories, all strictly sequentially. It now reads each
  directory once with `withFileTypes` and parses sibling subtrees concurrently
  under a bounded gate. Warnings and digest insertion order are merged in
  sibling order, so a depth-first walk's exact output is preserved — pinned by
  `parse-order-equivalence.test.ts` and verified byte-for-byte against the
  previous implementation on the full tree. **803 ms → 206 ms.**
  
  **No duplicate full-tree write.** Eighteen call sites ran
  `syncFolderTree(rexDir, store)` immediately after a store mutation.
  `FileStore` has written the tree inside the mutation's own locked span since
  the tree became the backend, so each of those re-read the whole PRD and
  re-serialized it for no byte of change — and did so *less* safely, since
  `syncFolderTree` passes no `loadedAt`/`loadedFiles` and so runs with the
  stale-save guard disarmed. Removed; the function stays for deliberate
  full-tree rebuilds. **~1.2 s saved per mutation.**
  
  **Single-parse reads** (`performance.fastReads`, default off).
  `loadItemsPreferFolderTree` parsed the tree, separately loaded the document —
  which parses the same tree — and merged the two, on top of the load its
  callers had already done. The merge predates the folder tree being the
  backend; both sides are now the same parse. `rex next` **2.41 s → 749 ms**
  with the flag on, output byte-identical.
  
  **Single-item writes** (`performance.fastWrites`, default off). A one-field
  update handed the whole document to the serializer, which walked every
  directory to find that all but one file was unchanged. The targeted path
  writes the item's own `index.md` and its parent's (whose children table
  prints the child's title and status) and nothing else, declining to the full
  write whenever the change could move a file or the item's on-disk path is not
  where the serializer would put it. `updateItem` **782 ms → 315 ms.**
  
  Both `performance` flags read from `.rex/config.json`, overridable per
  command with `REX_FAST_READS` / `REX_FAST_WRITES`. They default off: the
  previous path stays the one that ships until the new one is chosen
  deliberately.

- [#605](https://github.com/en-dash-consulting/n-dx/pull/605) [`e1393f0`](https://github.com/en-dash-consulting/n-dx/commit/e1393f02ee074010e9678873ba2ff1f39181a0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - The `N-DX-Item` commit trailer now carries the PRD item id rather than a dashboard permalink. The permalink was built from `web.publicUrl`, defaulting to `http://localhost:3117`, so every autonomous commit wrote the author's host into permanent history and resolved to nothing on any other machine; `web.publicUrl` no longer affects the trailer. Readers accept both forms — `itemIdFromTrailer` unwraps a permalink of any host to the same id — so commits written before this change keep attributing.

- [#579](https://github.com/en-dash-consulting/n-dx/pull/579) [`cf19d5a`](https://github.com/en-dash-consulting/n-dx/commit/cf19d5a29ffa9ad4df8bb2befb2dd3f266785e05) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the placement decision for a change on the product layer (`core/placement-policy.ts`). `rex.placement.models` (`text`, `jev`, `both`) chooses which tiers run beside the rules, and `rex.placement.autoAccept` (`none`, `agree`, `confident`) decides when a placement is accepted without a person; a change without one gets `needsPlacement`. Jev runs under its own `prd.place.judge` task class, which is not a default judgment route, so exporting `TYPESAFE_API_KEY` alone never turns it on. `confident` needs a Jev pick at confidence 0.8 or higher that is on the rules shortlist. Jev can abstain with a none-of-these option, which is never auto-accepted, and a Jev confidence that is not finite or is outside 0–1 is ignored with a warning. Without Jev, `both` falls back to the text model and `jev` to rules only, each with a warning. Not wired into the store, CLI or MCP yet.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`b2b021a`](https://github.com/en-dash-consulting/n-dx/commit/b2b021a4394a868057f8f83e7bdc848c19c9144c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `computeLandings` reports a change that is neither completed nor applied as not landed ("change still open"), so `resolveShippedIn` gives it no release; a change with one task merged and tagged and another unmerged no longer reads as shipped. It also resolves the main ref, checks for a shallow clone and loads the trailer and landing caches once per call instead of once per change. `core/change-landing.ts` joins the v2 modules in the isolation test.

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

- [#610](https://github.com/en-dash-consulting/n-dx/pull/610) [`b03c3a7`](https://github.com/en-dash-consulting/n-dx/commit/b03c3a74508c601c2e71596d6fc565a70cc3feb6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - New rex MCP tools for a v2 PRD: `get_product` (areas, capabilities and constraints with computed status and health), `get_capability` (one node with its parent chain, related changes, binding constraints and co-changes), `place_change` (the rules' placement shortlist without `target`; with `target`, records a touches or a modified amendment, with the amendment's `proposed` text and `criteria` delta, and clears `needsPlacement`; a criteria delta naming an id the capability lacks, or adding one it has, is refused at placement, as apply would refuse it) and `apply_change` (a steward applies a change's amendments whatever `rex.applyOn` says). Each refuses a v1 tree. On a v2 tree `get_prd_status` reports change counts, the Inbox count, product status per area and change counts per release. The assistant-assets manifest lists the four tools.

- [#610](https://github.com/en-dash-consulting/n-dx/pull/610) [`e6941fc`](https://github.com/en-dash-consulting/n-dx/commit/e6941fc042beeb45fb9ef91c102b2639f5ce4a43) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On a v2 PRD, rex MCP read tools no longer grow with change history. `get_capability` lists every open change plus the 10 most recently applied by default, with `status` (`recent`, `open`, `applied`, `all`), `since` (release), `cursor` and `limit` to read more, and reports `changeCounts` over all related changes and `changesPage.nextCursor`. The cursor is opaque and records the last row's position, so a change applied between pages no longer makes the listing skip the open changes after it. `get_prd_status` lists releases with open changes and the 5 newest closed ones (`allReleases` lists all, `releasesOmitted` counts the rest); its change counts still cover every change.

- [#531](https://github.com/en-dash-consulting/n-dx/pull/531) [`3cb924b`](https://github.com/en-dash-consulting/n-dx/commit/3cb924b648eb3076ac738b65caaff15a6f186c59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex migrate-slugs` now names the condition it actually checked when it refuses. The hint claimed the resolved store "is a remote adapter with no paths to rename", which was never the test and describes a backend kind that no longer exists; the guard checks whether the store implements `adoptSlugRule`, so that is what it now says.

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

- [#530](https://github.com/en-dash-consulting/n-dx/pull/530) [`7e7ef56`](https://github.com/en-dash-consulting/n-dx/commit/7e7ef56662296000ad88f0a2d0bcf718e5a984ba) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Every package's guidance now lives in its `AGENTS.md`, with the `CLAUDE.md`
  beside it reduced to the `@AGENTS.md` import. Zone policies and seam registries
  for `core`, `rex`, `hench` and `web` were readable only by Claude Code before
  this; Codex and any other assistant that reads nested `AGENTS.md` files now get
  them too. `tests/e2e/instruction-alignment.test.js` fails a package CLAUDE.md
  with no AGENTS.md beside it, or one carrying content of its own.

- [#585](https://github.com/en-dash-consulting/n-dx/pull/585) [`e18a6f3`](https://github.com/en-dash-consulting/n-dx/commit/e18a6f3cb6663afb72d6eb0d32a6405e6694a8bf) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tighten placement's rules. A change counts as a code-health finding only when it carries the `code-health` tag, no longer because its source is sourcevision. The relation is decided by an explicit `Relation: amends` or `Relation: touches` line in the intent, else by an amending verb opening the title (`Add`, `Support`, `Replace`, …), else touches; `fix: true` and `code-health` always touch. A change no rule matches can still get a new-capability proposal from the text model, which is given the list of areas, and a proposal under an unknown area is dropped. A proposal is never auto-accepted.

- [#585](https://github.com/en-dash-consulting/n-dx/pull/585) [`cc560f2`](https://github.com/en-dash-consulting/n-dx/commit/cc560f2ab365814ee414a7be905414fbc2642e50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A placement is now a target and a relation. `PlacementDecision.accepted`, each shortlist candidate and each Jev ranking entry carry `{ target, relation }`, with `relation` either `touches` or `amends`. The rules alone pick the relation: a change with `fix: true` or a code-health finding touches its target, a change whose title or intent asks for new behaviour amends it, and any other change touches it. The text model and Jev pick only the target. Constraints are ranked as candidates alongside capabilities, and a code-health finding (source `sourcevision` or tag `code-health`) is placed on the architecture constraint. The text model can propose a new capability or constraint under an area as an `added` amendment with a type. A proposal is never auto-accepted in any `autoAccept` mode, so it always leaves `needsPlacement` set for a person.

- [#579](https://github.com/en-dash-consulting/n-dx/pull/579) [`86751c5`](https://github.com/en-dash-consulting/n-dx/commit/86751c571f74bb04949e8b5cc1007eddf4ea1e21) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Rank placement candidates for a change from rules (package and path mentions, title word overlap, file evidence against realized-by) and an optional text model on the new `prd.place` task class; the model counts as agreeing only when it picks the rules' top candidate.

- [#531](https://github.com/en-dash-consulting/n-dx/pull/531) [`3700d62`](https://github.com/en-dash-consulting/n-dx/commit/3700d62dc7a521353c813d5bab0776eef097bf07) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Remove `src/store/adapter-config.ts` — the last of the tracker-integration code.
  
  `adapter-config.ts` was the remains of the adapter registry: `.rex/adapters.json`
  persistence plus credential redaction and environment resolution. It was extracted
  as a neutral module when the Notion, Jira, Asana and GitHub Projects adapters were
  deleted, specifically so the dashboard's `routes-notion.ts` could keep reading the
  file. That route has since been deleted too, which left the module with no caller
  anywhere in the repository while it was still exported from `public.ts` and
  `src/store/index.ts`.
  
  Gone from the public API: `loadAdapterConfigs`, `getAdapterConfig`,
  `saveAdapterConfig`, `removeAdapterConfig`, `isSensitiveField`, `envVarName`,
  `redactValue`, `isRedactedField`, `resolveRedactedConfig`, and the `AdapterConfig`,
  `AdapterConfigField` and `RedactedField` types.
  
  This supersedes the earlier plan to keep the redaction and env-var helpers for a
  future work-tracker bridge. That plan predated the removal of their last caller.
  Keeping them would have frozen a credential-persistence API for a feature that no
  longer exists into the frozen public surface, on the strength of a consumer that does not
  exist yet and will own its own config when it does — the helpers are forty lines of
  string manipulation, cheaper to write again in the right package than to carry as a
  semver commitment in the wrong one.
  
  `file-adapter.ts` (the local store) and `src/core/sync.ts` (item bookkeeping, not the
  sync engine) are untouched, as before.
  
  Two pieces of housekeeping travelled with it, because both were about this removal:
  
  - `packages/rex/tests/integration/domain-layer-boundary.test.ts` still listed
    `../../store/adapter-registry.js` in `KNOWN_VIOLATIONS` after that file was
    deleted. The list is only ever read as "is this import permitted", so an entry
    whose module is gone permits nothing and nothing complains — it just leaves the
    tracked surface describing imports that cannot happen. The entry is removed and a
    new assertion fails on any `KNOWN_VIOLATIONS` entry whose module no longer exists,
    so the next deletion cannot leave one behind.
  - The changeset for the original adapter removal said the credential helpers
    "stayed". They ship in the same release as this change, so that sentence would
    have contradicted this entry in a single changelog. It now says they were moved at
    that step and removed later, which is what happened.
  
  `docs/archive/collaborative-workflows-discovery.md` still describes the adapters and
  `.rex/adapters.json`. That is deliberate: the archive is explicitly point-in-time
  ("every page here describes the state of the project on the date it was written and
  has not been maintained since"), and it is retained to record why a decision was
  made. Editing it would falsify the record rather than update it.

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

- [#531](https://github.com/en-dash-consulting/n-dx/pull/531) [`d52dcd2`](https://github.com/en-dash-consulting/n-dx/commit/d52dcd20be39bb165bdfcb7d6f391bd7c07fd874) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Remove the documentation for the tracker adapters, `ndx sync`, `rex sync`, `rex
  adapter` and the `sync_with_remote` MCP tool, and drop `.rex/adapters.json` from
  the recommended `.gitignore` template.
  
  The code went in the two changes before this one. Documentation that outlives
  the feature it describes is worse than no documentation: a reader who finds
  `ndx config rex.adapter notion .` in a guide has no way to tell it is a fossil
  until they run it, and a command reference listing a command that no longer
  exists makes the whole reference untrustworthy. A work-tracker bridge ships
  later as its own package; when it does it gets its own documentation, written
  against the storage model that will actually exist rather than inherited from
  the adapters it replaces.
  
  Gone from the guides: the "Using `ndx sync` for team-backed PRDs" section of
  [Keeping Your PRD Alive](https://n-dx.dev/guide/change-management) along with
  its two Notion team workflows, conflict-resolution rules and the external-adapter
  branch of the maintenance checklist; the `ndx sync` row in the command
  reference; the `sync_with_remote` row in the MCP tool tables of the MCP guide,
  the rex package page and rex's own README; the `ndx sync` row and the
  `sync_with_remote` entry in `@n-dx/core`'s README, which is the package's npm
  page; and the `rex sync` / `rex adapter` examples from the rex CLI listing.
  Rex's README also now lists `claim_task` and `release_task`, so its stated tool
  count matches the eighteen tools the server registers.
  
  A new check in `tests/e2e/command-docs-parity.test.js` runs the existing parity
  rule in the other direction: every `ndx <command>` row in the repository README,
  the command guide and `@n-dx/core`'s README must name a command the registry
  knows. Before this, a removed command could stay documented indefinitely.
  
  **`change-management.md` was kept rather than deleted.** The task that
  scheduled this work called for the whole file. Four of its five sections —
  drift detection, the four-cycle maintenance loop, archive management and the
  recovery playbook — have nothing to do with trackers and nothing else documents
  them; the sync material was about 15% of the page. Deleting all of it to remove
  that 15% would have cost four sections of live guidance and broken the sidebar
  entry plus two inbound links for no gain. The tracker content was excised
  instead, which satisfies the same requirement.
  
  Three references to files that no longer exist were corrected while they were
  in reach: `rex/src/core/notion-map.ts` in the level-system reference,
  `routes-integrations.ts` and `routes-notion.ts` in the zone inventory, and the
  Notion and integrations sections of the Project view in the accessibility route
  table. The `/notion-config` and `/integrations` redirect aliases are still
  documented in the viewer architecture page, because those aliases still exist —
  they point at `/project` for 0.8.0 URL compatibility.
  
  `.rex/adapters.json` is gone from the recommended ignore template
  (`packages/core/assistant-assets/ndx.gitignore`) and from the three documented
  copies of it. Nothing produces the file any more. `ndx init` does not apply that
  template — users copy it by hand — so an existing project's `.gitignore` is
  untouched and keeps ignoring any `adapters.json` left over from an old setup. The repository's own `.gitignore` drops the entry in the same
  change, because `tests/unit/ndx-gitignore-template.test.js` requires the
  template and this repository to list identical `.rex/` entries.
  
  The dated audit tables in `docs/cli-ui-gap.md` keep their `ndx sync` row, with a
  note that the command was since removed. That table records what shipped on a
  given date; rewriting it would falsify the history it exists to preserve. The
  current-state inventories in the same file did drop the removed rows.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`5802bc2`](https://github.com/en-dash-consulting/n-dx/commit/5802bc221ecab89d6be697b65e90d6db8c138674) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Rex can re-point recorded commit SHAs that a rebase, cherry-pick or squash rewrote to the commit they became on main (same author date and subject, patch-id, or N-DX-Item trailer and subject, then an optional host pull-request lookup), returning unmatched SHAs with a reason. `exec` gains an `input` option that writes to the child's stdin.

- [#604](https://github.com/en-dash-consulting/n-dx/pull/604) [`ac9592e`](https://github.com/en-dash-consulting/n-dx/commit/ac9592eeb6bc361aed36ae106ceaa28d4d710b2d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex add` and `rex update` now support repeatable `--criterion` and `--source` flags in manual mode, matching MCP `add_item` and `edit_item` ([#511](https://github.com/en-dash-consulting/n-dx/issues/511)). Structured acceptance criteria can now be set from the CLI without the MCP server or manual JSON editing.

- [#591](https://github.com/en-dash-consulting/n-dx/pull/591) [`b6c2324`](https://github.com/en-dash-consulting/n-dx/commit/b6c2324e6d597cecdb2b19523f0b2410561f4249) Thanks [@ryrykeith](https://github.com/ryrykeith)! - New `rex codeowners` generates `CODEOWNERS` and `.bitbucket/CODEOWNERS` from the product layer's stewards (root default, per-area override), one rule per area folder. Opt-in with `"codeOwners": true` in `.rex/config.json`; `--check` reports stale files. `@org/team` handles go to the GitHub file only, with a warning for the Bitbucket omission.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`81a283a`](https://github.com/en-dash-consulting/n-dx/commit/81a283afe4f66520417fdf06b5008c985ec5c1a1) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add a `criteria-growth` tree rule that warns when a capability's own plus inherited criteria exceed 15, configurable as `structureHealth.maxCriteriaPerCapability`.

- [#573](https://github.com/en-dash-consulting/n-dx/pull/573) [`c3d5eb0`](https://github.com/en-dash-consulting/n-dx/commit/c3d5eb070761ab8054c6a78f444db4833c203914) Thanks [@ryrykeith](https://github.com/ryrykeith)! - PRD folder tree: a backslash in a quoted string field (e.g. a title `C:\new dir`) no longer reads back as a newline, and `\r` and `\uXXXX` escapes now decode. The frontmatter parser decodes double-quoted values with `JSON.parse`, matching how both tree writers quote them.

- [#526](https://github.com/en-dash-consulting/n-dx/pull/526) [`cc10e8f`](https://github.com/en-dash-consulting/n-dx/commit/cc10e8f9de93dd0733358d4c57b7ff4c92737eca) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Front matter now keeps `loe` as a number and keeps `loeRationale` and `loeConfidence`, and no object-valued field is written as `[object Object]`.

- [#520](https://github.com/en-dash-consulting/n-dx/pull/520) [`0ec098a`](https://github.com/en-dash-consulting/n-dx/commit/0ec098ae8fe51a8f62a7a8e8400eba9e47971a1d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex mcp .` now serves the worktree named by the client's MCP roots, so a Claude desktop session in a linked worktree writes that worktree's PRD rather than the main checkout's ([#499](https://github.com/en-dash-consulting/n-dx/issues/499)). A root naming another worktree of the same repository that has no `.rex/` refuses writes instead of falling back. An explicit directory (`rex mcp /abs/path`) and the dashboard's HTTP MCP keep the directory they were given. `get_capabilities` reports the served `workspace`. `@n-dx/llm-client` exports the shared `resolveWorkspaceFromRoots` helper.

- [#537](https://github.com/en-dash-consulting/n-dx/pull/537) [`0845cde`](https://github.com/en-dash-consulting/n-dx/commit/0845cde144ff5365a24d0df7cbd48752870e9492) Thanks [@ryrykeith](https://github.com/ryrykeith)! - PRD items can carry a `run` block of saved run settings (a portable model `tier`, optional per-vendor `models` pins, provider, permission mode, review, `reviewTier`, `reviewModels`, review optional, skip test gate, max turns, token budget, context notes). Saved settings are vendor-agnostic, so a task saved under Claude still carries its model intent when run on Codex; there is no bare `model` key. An unknown vendor name in `models` is rejected with the valid list. It round-trips through the folder tree, an empty block is never written, and rex exports `validateRunSettings` so every writer applies the same rules. Writers (MCP, `rex update --run`) reject a malformed block; the store keeps a hand-edited or newer-version block unchanged, warns on load, and never lets it block writes to other items. Nothing reads the block yet.

- [#537](https://github.com/en-dash-consulting/n-dx/pull/537) [`26a7883`](https://github.com/en-dash-consulting/n-dx/commit/26a7883836aae2d1a1bbea9f827d6675f9ee08bb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The saved `run` block is writable through MCP `add_item` / `edit_item` (`edit_item` replaces the whole block, `run: null` removes it) and `rex update --run='<json>'` (`--run=` or `--run=null` clears it); invalid JSON or an unknown key exits non-zero listing the valid keys, and an unknown vendor in `models` is rejected naming the valid vendors. `PATCH /api/rex/items/:id` now accepts only status, failureReason, priority, tags, title, description, acceptanceCriteria and requirements (any other key is a 400 naming it) and does its read-modify-write inside the PRD lock, answering 409 when another process holds it.

- [#589](https://github.com/en-dash-consulting/n-dx/pull/589) [`878ff2f`](https://github.com/en-dash-consulting/n-dx/commit/878ff2facb3cacb20f6727d0eca07d5a3e20f765) Thanks [@ryrykeith](https://github.com/ryrykeith)! - New `rex merge-state` git merge driver for the v2 trees' per-folder `state.yaml`: rows merge by item id, so children added or completed on parallel branches merge cleanly. A `metAt` both sides changed is recomputed from the node's spec hash, and a `status` both sides changed reads `completed` when the merged row records a completion; anything else that cannot be decided leaves conflict markers on that field. `ndx init` pins `<rex>/product/**/state.yaml` and `<rex>/changes/**/state.yaml` to `merge=rex-state` and registers the driver beside `rex-prd`.

- [#618](https://github.com/en-dash-consulting/n-dx/pull/618) [`33eb557`](https://github.com/en-dash-consulting/n-dx/commit/33eb557571c1c3d0020a08e0d12318c34729600a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Turn `rex backfill-commit-attribution` into a read-only trailer coverage report.
  
  Schema v2 stores no `commits` on an item — a commit's SHA is not its identity, so a change's commits are computed from its `N-DX-Item` trailers on demand. That left the backfill writing state nothing reads. What survives is the question it was really answering: how much of history can be attributed at all, which is worth knowing before the trailer format is frozen.
  
  The command now reports, for every commit reachable from the default branch, whether its message carries an `N-DX-Item` or `N-DX-Status` trailer — grouped by author and by month, with totals. `--json` (or `--format=json`) prints the same report machine-readably, and `--ref=<branch>` reads another branch.
  
  It writes nothing: not under the rex directory, not the trailer cache `change-commits.ts` keeps, and it no longer loads the PRD at all.
  
  Two counts are reported rather than one, because they disagree and the gap matters. `covered` scans the whole message; `attributed` asks git's own trailer parser, which is what attribution actually reads — and git reads trailers only from a message's final paragraph. On this repository 67 of the 79 covered commits write the trailer outside it, so a single number would either call history covered that nothing can attribute, or hide that the trailer was written at all. Merge commits are counted separately for the same reason: they carry no trailer by construction.
  
  A git failure — an unknown ref, a shallow CI checkout — now fails the command with the cause named. The predecessor caught it and returned normally, which reported an unreadable log as success.

- [#583](https://github.com/en-dash-consulting/n-dx/pull/583) [`43bfdc2`](https://github.com/en-dash-consulting/n-dx/commit/43bfdc2a54c741ce489f8773addad39fd6e91ebd) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the v2 apply engine (`core/apply-amendments.ts`). It applies a change's amendments to the product layer with no model call. `added` creates a capability under an area or capability. `modified` writes the proposed statement and adds, replaces or removes criteria by id. `removed` retires the node by setting its status to `deleted`. Each amended node gets a History line, and each added or modified node gets `metAt`, the hash of its statement and criteria only, so editing the prose body never changes it. The change gets `appliedIn`. A change that only touches nodes leaves `product/` byte-identical. Any problem refuses the whole apply and leaves the tree as it was. Add the product-edit handler (`core/product-edit.ts`) for direct edits to a capability or constraint. An editorial edit re-stamps `metAt`. Any other edit leaves the node revised and drafts one Inbox change with `source: "product-edit"`. A later edit refreshes that draft while it is open and unapplied, instead of drafting a second one. An edit back to the met spec withdraws that draft: it drops the node's amendment, cancels a draft left empty, and clears `revisedAt`. v2 is still not wired to the store.

- [#610](https://github.com/en-dash-consulting/n-dx/pull/610) [`8f74ce5`](https://github.com/en-dash-consulting/n-dx/commit/8f74ce575d927ce8f2b945631b48e299512d8006) Thanks [@ryrykeith](https://github.com/ryrykeith)! - v2 changes take an optional, typed `acceptanceCriteria` list ("done when" for the change's own work), the same shape as a task's. The split rule moves it to a task-less change's first task. It never feeds the spec hash or product status, which read only a capability's capability criteria.

- [#594](https://github.com/en-dash-consulting/n-dx/pull/594) [`aec78fd`](https://github.com/en-dash-consulting/n-dx/commit/aec78fdbf418c367c13fc5ea27583ce8bfba39d5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add v2 change completion (`core/change-completion.ts`, not wired yet): a change completes when its last live task does (a pending change only; cancelled tasks block, deleted ones are ignored), or on its own when task-less, then applies to the product layer per `rex.applyOn`. A task-less in-progress change that gains its first task hands its in-flight work and acceptance criteria to that task.

- [#594](https://github.com/en-dash-consulting/n-dx/pull/594) [`966f42b`](https://github.com/en-dash-consulting/n-dx/commit/966f42bb67c4ed3427ffec328afcbd1c3520268a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add v2 work selection (`core/change-selection.ts`, not wired yet): picks placed changes and tasks, a task-less change being its own unit; orders by priority, then nearest `plannedRelease`, then dependency order. `needsPlacement` blocks autonomous selection only; `resolveWorkById` still returns it. `readyOnly` and `assignee` filters are opt-in.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`b24dea0`](https://github.com/en-dash-consulting/n-dx/commit/b24dea028c2d8b623a9c87a25df5f5fd7a309476) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Schema v2 no longer stores a change's `commits`. They are now worked out from `N-DX-Item` trailers (both the permalink form and the bare id) on commits reachable from main. A rebase or squash changes a commit's SHA but keeps its trailer. The result is cached in rex's `.cache` directory. A `state.yaml` that still has `commits` still loads; the key is kept but ignored, and the new `retired-state-field` rule warns about it.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`e0085f3`](https://github.com/en-dash-consulting/n-dx/commit/e0085f37d3b81e6b25b2bc6416687c29e63a7115) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add computed edges for the v2 product layer (`core/product-edges.ts`): `changedBy` and `boundBy` (inverses of `amends` and `appliesTo`), `coChanges`, `realizedBy` (commits, files and zones of the changes that amended a capability, found by `N-DX-Item` trailer), and the derived change kind (feature, enhancement, retirement, fix, refactor, policy change, spike). A ref that is an alias of a folded id resolves to the node it was folded into. The files per commit are cached in `<rexDir>/.cache/commit-files.json` (gitignored) and rebuilt when missing. v2 is still not wired to the store.

- [#565](https://github.com/en-dash-consulting/n-dx/pull/565) [`8f4385a`](https://github.com/en-dash-consulting/n-dx/commit/8f4385ab8e82bdc66b6e3a44bdd8bb64e0fb7af7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add a dual-read PRD loader (`store/prd-model-reader.ts`) that reads either the v1 `prd_tree` (levels mapped to v2 types) or the v2 `product/` and `changes/` roots (intent merged with `state.yaml`) into one model. State fields found in v2 frontmatter are dropped with a warning, so `state.yaml` stays the only source of status. A schema major this build cannot read is refused with a message naming both versions and the fix; `NDX_IGNORE_SCHEMA_SKEW=1` or `--ignore-schema-skew` reads it for inspection with a stderr warning and refuses every write. v2 is still not wired to the store.

- [#528](https://github.com/en-dash-consulting/n-dx/pull/528) [`ff18c5f`](https://github.com/en-dash-consulting/n-dx/commit/ff18c5f8c6edca19f7a8c4032f60b77bb7317afa) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the v2 PRD schema: node types, intent and state fields, and the v2 validation rules as pure functions. Not wired to the store yet, so nothing reads or writes v2 trees.

- [#583](https://github.com/en-dash-consulting/n-dx/pull/583) [`7f24f8a`](https://github.com/en-dash-consulting/n-dx/commit/7f24f8abfe6790df3a19bc00408f94782a44afcf) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Handle direct edits to the v2 product layer (`core/product-edit.ts`). An editorial edit re-stamps `metAt` and records a History line. Any other edit leaves the node revised and drafts one change, with `source: product-edit` and `needsPlacement`. A later edit refreshes that draft instead of drafting a second change, and an edit back to the met spec withdraws it. A completed but unapplied draft is reported as stale and never modified. Every History line is written on one line. The v2 `depends-on-acyclic` rule now reports one finding per set of mutually dependent capabilities, on its smallest-id member with the members in sorted order, so the same cycle is reported the same way every time. Retiring a node that still has live descendants is refused unless the same change removes them too. v2 is still not wired to the store.

- [#584](https://github.com/en-dash-consulting/n-dx/pull/584) [`441efa9`](https://github.com/en-dash-consulting/n-dx/commit/441efa9b87a779d0b433688a72a3bde18a9ab753) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Compute intent status and health for v2 capabilities and constraints (`core/product-status.ts`). Status is retired, changing, proposed, revised or met. A node reads changing only while a building change (started, or placed out of the Inbox) amends it or a parent capability, so an untouched Inbox draft leaves it revised; `long-revised` uses the same definition. Health is defective when a current check fails (results for removed requirements are ignored, latest per requirement wins) or an open fix targets the node; a retired node is always ok. Both are derived on read and never written to intent or state files. v2 is still not wired to the store.

- [#580](https://github.com/en-dash-consulting/n-dx/pull/580) [`4670500`](https://github.com/en-dash-consulting/n-dx/commit/46705002256ecb6445d01f297c69ab0d59beafb9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Three more v2 rule errors before the freeze. `ref-resolves` rejects an unapplied change that adds a target some node already claims by id, display id or alias, live or retired, since apply would create a second node under that ref. `ref-unique` rejects a live node whose id a tombstone holds (display ids may be renumbered and a folded id kept as an alias stays allowed). `change-placed-at-close` also fires on an applied change that still carries `needsPlacement`.

- [#580](https://github.com/en-dash-consulting/n-dx/pull/580) [`ab06a3c`](https://github.com/en-dash-consulting/n-dx/commit/ab06a3c767ad4a1904f738341852da3cfedf48b5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Tighten the v2 validation rules before the schema freeze. A change is applied only when `appliedAt` is set, and a completed but unapplied change stays open (`isAppliedChange` and `isOpenChange` are now exported). Inbox changes (`needsPlacement`) may have no target yet but cannot close unplaced. New errors cover a change that is both a fix and a spike, a `type` on a modified or removed amendment, duplicate check results, ids, display ids or aliases claimed by two nodes, and references that name no node. A check result for a requirement the node no longer has is a warning. `indexTree` is exported, resolves ids before aliases, and can index retired nodes with `includeTombstones`. v2 is still not wired to the store.

- [#580](https://github.com/en-dash-consulting/n-dx/pull/580) [`0eb2303`](https://github.com/en-dash-consulting/n-dx/commit/0eb2303255ac0d8d32a7050201859f4bbd3e4014) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 rules now reject an open change that touches, modifies or adds under a retired product node (`open-change-refs-live` covers every product reference, not only removals), and a change that adds the same target twice (`ref-resolves`; the first addition still stands). Applied changes may still reference retired nodes.

- [#580](https://github.com/en-dash-consulting/n-dx/pull/580) [`a7f4f2c`](https://github.com/en-dash-consulting/n-dx/commit/a7f4f2c86bc0048de1068b89fa4f31d5bc147305) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The v2 `ref-resolves` rule now rejects a change whose added nodes are placed under themselves or in a cycle, and a reference that names the wrong kind of node: touches, amendment targets and appliesTo must name product nodes, dependsOn a capability, blockedBy a change-layer node, and an added node's `under` a node that can hold it. `open-change-refs-live` now reports only retired targets.

- [#559](https://github.com/en-dash-consulting/n-dx/pull/559) [`22f46cd`](https://github.com/en-dash-consulting/n-dx/commit/22f46cd853c558acbee7603e6358808913c7de09) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Correct the v2 PRD schema before any v2 files are written: the map layer is now the product layer (`ProductNodeType`, `PRODUCT_NODE_TYPES`, `V2Tree.product`), level-of-effort fields (`loeRationale`, `loeConfidence`) are declared and `effort` is reserved, change intent records `discoveredFrom` (the item or run that found it), and change and task intent carry an optional saved run-settings block (`run`) checked by a new run-settings warning rule. v2 is still not wired to the store.

- [#580](https://github.com/en-dash-consulting/n-dx/pull/580) [`ff842c5`](https://github.com/en-dash-consulting/n-dx/commit/ff842c57c3095f49ed305a19709f7c071c6b5f55) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the v2 PRD schema fields decided before the freeze, all optional: `fix` on a change; `type` (capability or constraint) and `base` (the target's spec hash when drafted) on an amendment; `commit` on a check result; `reviewedHash` on product-node state, replacing `specReviewed`; and `appliedAt` and `appliedAmendsHash` on change state, replacing `appliedIn`. `appliedIn` and `specReviewed` are retired: an older `state.yaml` that still has them loads and keeps them unconverted, and a new `retired-state-field` warning rule reports them. `unreviewed-spec` now compares `reviewedHash` with the current spec hash. v2 is still not wired to the store.

- [#559](https://github.com/en-dash-consulting/n-dx/pull/559) [`0196dec`](https://github.com/en-dash-consulting/n-dx/commit/0196decec982928a3528e52d8165d6318cef818c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the v2 state writer (`store/state-writer.ts`), the one module that reads and writes per-folder `state.yaml`. Output is canonical (fixed key order, LF endings), unknown keys keep their original line byte for byte, writes refuse to run outside the PRD lock, and `revisedAt` is stamped and cleared against `metAt`. The file lock gains `isLockHeld`. v2 is still not wired to the store.

- [#610](https://github.com/en-dash-consulting/n-dx/pull/610) [`034fecb`](https://github.com/en-dash-consulting/n-dx/commit/034fecbb0c5bb282bf50c9c24724272b67130891) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Adds `withPrdModelTransaction`, the v2 write path: it loads the product and change layers, runs the caller's mutation and writes the result under one hold of the PRD lock, and refuses a v1 tree.

- [#565](https://github.com/en-dash-consulting/n-dx/pull/565) [`454b148`](https://github.com/en-dash-consulting/n-dx/commit/454b148804a7b0505674748a9b8f7d26b025b000) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the v2 tree writer (`store/prd-model-writer.ts`). Paths come from each node's frozen `slug`, so a title edit never moves a file. No `index.md` gets a Children table. Intent goes to Markdown and state goes to `state.yaml`. The schema stamp and slug rule go in `product/index.md`, not `tree-meta.json`. A change is always a folder. The writer refuses to delete a file holding a node the model lacks unless the caller names it as removed. Under the PRD lock it re-reads the root stamp from disk and refuses a tree that is not stamped v2, whatever its `state.yaml` files say. When a node moves to another folder, or a leaf becomes a folder, the state fields this build does not know stay in the node's `state.yaml` row and do not leak into its Markdown. A slug Windows cannot create (a device name such as `con` or `nul`, a trailing dot or space, or a character such as `:`) is refused before any file is written; the check is exported from the store as `isWindowsSafeSegment`. The v2 fixture round-trips byte-identically. v2 is still not wired to the store.

- [#565](https://github.com/en-dash-consulting/n-dx/pull/565) [`aef2f1f`](https://github.com/en-dash-consulting/n-dx/commit/aef2f1f454bfad3c2da1eef844ce83d680937245) Thanks [@ryrykeith](https://github.com/ryrykeith)! - v2 trees on a Windows CRLF checkout: the reader loads a CRLF file into the same model as its LF copy (bodies included), and the v2 writer and `state.yaml` writer leave a file alone when it differs only by CRLF. `ndx init` now pins `<rexDir>/**/*.yaml` (the v2 `state.yaml` files) to LF.

- [#527](https://github.com/en-dash-consulting/n-dx/pull/527) [`dd1e933`](https://github.com/en-dash-consulting/n-dx/commit/dd1e933604ef70fe18e1eb1361a4fee93dbbc936) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Split the rex MCP tool handlers into one module per tool behind a registry.
  
  `cli/mcp-tools.ts` held all nineteen tools in one 1,083-line file and `mcp.ts`
  held their names, descriptions and input schemas inline, so every MCP change
  touched both. Each tool now owns its name, description, schema, access kind and
  handler in `cli/mcp-tools/<tool>.ts`; `registry.ts` lists them in registration
  order and `mcp.ts` registers whatever it lists.
  
  Behaviour-neutral: the `tools/list` response is byte-for-byte identical, and a
  snapshot generated from the pre-split server is checked into
  `tests/unit/cli/mcp-tools-list-snapshot.test.ts` as the evidence.

- [#547](https://github.com/en-dash-consulting/n-dx/pull/547) [`6187c2a`](https://github.com/en-dash-consulting/n-dx/commit/6187c2ad176f8c74d66dcdbc306ece63c3d08935) Thanks [@ryrykeith](https://github.com/ryrykeith)! - On Windows, PRD store writes retry a rename that fails because another process briefly has the target open (EPERM, EACCES or EBUSY), instead of failing the command. The temp file is removed if the rename still fails.
- Updated dependencies [[`1dfc0c7`](https://github.com/en-dash-consulting/n-dx/commit/1dfc0c7e7947ffa6054cb6ef9efc214805253a16), [`eff0f79`](https://github.com/en-dash-consulting/n-dx/commit/eff0f79db748ee2ec71c27abbde166fdcfbfc722), [`cf19d5a`](https://github.com/en-dash-consulting/n-dx/commit/cf19d5a29ffa9ad4df8bb2befb2dd3f266785e05), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b), [`f46b952`](https://github.com/en-dash-consulting/n-dx/commit/f46b95235daf551cd0cc7c13ae162204aff74527), [`8bae238`](https://github.com/en-dash-consulting/n-dx/commit/8bae2381270ebcd2c419b4c8d8c90ffd87ac3047), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b), [`86751c5`](https://github.com/en-dash-consulting/n-dx/commit/86751c571f74bb04949e8b5cc1007eddf4ea1e21), [`fefc307`](https://github.com/en-dash-consulting/n-dx/commit/fefc3072a4a1f7a902a5f456fa4475faeebb5b71), [`5802bc2`](https://github.com/en-dash-consulting/n-dx/commit/5802bc221ecab89d6be697b65e90d6db8c138674), [`0ec098a`](https://github.com/en-dash-consulting/n-dx/commit/0ec098ae8fe51a8f62a7a8e8400eba9e47971a1d), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b), [`ce25794`](https://github.com/en-dash-consulting/n-dx/commit/ce2579434098c1994c73d91b1964f2b54b8f202f), [`b671123`](https://github.com/en-dash-consulting/n-dx/commit/b6711238559f132c7f0f7099b525d08108cfc445), [`59d6000`](https://github.com/en-dash-consulting/n-dx/commit/59d60002596915310e72da11605c6ebcc3dbd70b)]:
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

- [#444](https://github.com/en-dash-consulting/n-dx/pull/444) [`0f927d1`](https://github.com/en-dash-consulting/n-dx/commit/0f927d1c8026fb17d997b2e6b83d017795f8898a) Thanks [@endash-shal](https://github.com/endash-shal)! - Drop the unreachable id check from the stale-save guard, and correct the docs around it.
  
  Putting the content-digest check ahead of the item-id check made the id check unreachable: a file that reaches it has already failed the digest, so it differs from what the snapshot read, and both branches returned the same answer. Removing it also removes the `savedIds` parameter and the `collectItemIds` walk over the whole tree, which ran on every save. The surrounding docstrings described the id as the thing distinguishing a relocation from a deletion; the digest is, and they now say so.

- [#442](https://github.com/en-dash-consulting/n-dx/pull/442) [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add an optional `assignee` field to PRD items and `ndx work --mine`.
  
  `PRDItem.assignee` is an optional identity string, in the same "Name
  <email>" form `resolveActor` (git `user.name` + `user.email`, falling back
  to the OS username) resolves for `lastModifiedBy`. It round-trips through
  the folder tree via the existing passthrough-field path and is omitted
  entirely when unset — a tree with no `assignee` fields selects tasks
  exactly as it always has.
  
  `findNextTask` / `findActionableTasks` gained an `assignee` filter option
  (exact match, unset by default) alongside the existing `tags` filter.
  `hench run --mine` (and `ndx work --mine`) resolves the current user the
  same way rex stamps `lastModifiedBy`, and restricts autoselection to tasks
  assigned to that identity. Like `--tags`, an explicit `--task` bypasses the
  filter, and it is not supported together with `--epic-by-epic`.
  
  `resolveActor` is now re-exported through hench's `rex-gateway.ts` so hench
  resolves the current user the same way rex does, rather than keeping a
  second, driftable definition of "who is running this" (the gateway's export
  cap moves from 42 to 43 accordingly).

- [#505](https://github.com/en-dash-consulting/n-dx/pull/505) [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Claude API requests now send `llm.effort` as `output_config.effort`, and Claude Opus 5.5 defaults to `high` effort. `llm.effort` was parsed but never sent. With no matching rule, `claude-opus-5-5` gets `high` so the move from Opus 5 keeps its reasoning depth (Opus 5.5's API default is `medium`), and other models are unchanged. Effort is never sent to a model that rejects it (Haiku 4.5, Sonnet 4.5 and older) or when the value is not `low`, `medium`, `high`, `xhigh` or `max`; both cases print a warning. Claude Code CLI runs are unchanged.

- [#427](https://github.com/en-dash-consulting/n-dx/pull/427) [`f31ece3`](https://github.com/en-dash-consulting/n-dx/commit/f31ece3356eeb3450f62e3ffcebde43852c61bd6) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the stale-save guard from refusing a save that would repair a corrupt item file.
  
  The guard compares each deletion candidate's `mtimeMs` against a `Date.now()` load stamp, and those are two different clocks — the filesystem clock was measured running up to ~4ms ahead of `Date.now()` on Windows, past the guard's 2ms tolerance. A file written just *before* a load could therefore read as newer than it.
  
  For a file with no parseable `id` — a corrupt or truncated one — the check ended there and reported it as another writer's work, so the save that would have rewritten it was refused. The corruption became permanent: every subsequent save failed the same way.
  
  The content-digest check that already existed now runs first. If a file still digests to exactly what the snapshot loaded from that path, the snapshot has seen its current contents and deleting it destroys nothing unseen, whatever its mtime says. Files the snapshot never read keep the guard's full mtime-based protection.

- [#439](https://github.com/en-dash-consulting/n-dx/pull/439) [`39c6d80`](https://github.com/en-dash-consulting/n-dx/commit/39c6d80441aba2c3dd71d94494b58bf42fc5a4a0) Thanks [@endash-shal](https://github.com/endash-shal)! - Route rex and sourcevision file access through their paths modules
  
  Every site that composed its own `.rex/` or `.sourcevision/` path now asks the
  layout resolver instead, so both packages follow whichever folder layout a
  project is on rather than assuming the legacy one. `REX_DIR` and `SV_DIR` are
  gone — a bare directory name is the thing that made the layout a decision taken
  at ~120 call sites.
  
  Behaviour on a legacy project is unchanged. Three user-visible details moved
  from a fixed string to the resolved location: the legacy-PRD migration banner
  now names the folder tree the migration actually wrote (reported by
  `ensureLegacyPrdMigrated` as `folderTreePath`), `rex export`'s refusal message
  names the PRD directory the project actually uses, and `sv analyze`'s background
  narration log path follows the analysis directory.
  
  `packages/sourcevision/src/export/` bundles into the dependency-free standalone
  iso-map skill and so cannot import the resolver; it carries a hand-written twin,
  `analysisDirFor`, pinned to the canonical implementation by
  `tests/integration/layout-resolver-contract.test.js`.

- [#454](https://github.com/en-dash-consulting/n-dx/pull/454) [`d6a6c0c`](https://github.com/en-dash-consulting/n-dx/commit/d6a6c0c0d0f01674e58b8eddd9855909787b01fa) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Scope `--mine` to what it acts on, name the identity when it matches nothing,
  and inherit blockers in `rex ready`.
  
  `--mine` now matches an item whose own `assignee` *or any ancestor's* carries
  the identity. Matching only the item's own field meant handing someone a
  feature or an epic selected nothing at all, because the tasks beneath it carry
  no field of their own. The rule lives in rex's new `matchesAssignee`, exported
  through hench's `rex-gateway.ts` (export cap 43 → 44) so "mine" means the same
  thing everywhere it is asked.
  
  The deferred/failing reset offered when a `--mine` menu comes back empty now
  counts and resets only that identity's tasks. It previously counted the whole
  PRD and, on "y", reset every deferred and failing task in it — other people's
  included, committed under the answering operator's name. `ndx work --mine
  --reset-deferred` is scoped the same way.
  
  When `--mine` matches nothing, the message names the identity `resolveActor`
  produced and says how many actionable tasks exist without the filter; `--loop`
  no longer reports "All tasks complete", which described the whole project after
  looking at one slice of it.
  
  `rex ready` no longer marks an item whose ancestor is blocked, cancelled,
  deleted, or has an open `blockedBy`. It inherited requirements from ancestors
  but checked blockers only on the item itself, so a task under a blocked epic
  was marked ready although task selection would never offer it. Readiness and
  selection now share one predicate (`traversalBlock`), and the evaluation names
  the offending ancestor in its `reason` and in a new optional `blockedAncestor`
  field.

- [#440](https://github.com/en-dash-consulting/n-dx/pull/440) [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91) Thanks [@endash-shal](https://github.com/endash-shal)! - Leave an analyze run's recorded cost unset when it cannot be known
  
  `priceAnalyzeTokenUsage` ignored `resolveModelPricing(...).known` and priced
  every run, so an unpriced model was charged at the fallback rates — which are
  `claude-sonnet-5`'s, making the guess indistinguishable from a real sonnet run.
  A run whose provider omitted usage priced to exactly `0`. Both reached the
  `analyze_token_usage` log as numbers, and `ndx`'s run summary presents whatever
  number it finds as actual spend.
  
  It now returns `undefined` unless both the token counts and the model's pricing
  are known. `JSON.stringify` drops the key, and `formatCost` renders a missing
  cost as "not recorded" — which tells an operator to go and look, where "$0.00"
  does not.

- [#442](https://github.com/en-dash-consulting/n-dx/pull/442) [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Point SourceVision's pull-request markdown at the folder tree through rex, fixing an empty Completed Work section.
  
  The branch-work collector read `.rex/prd.md`, which no longer exists once a project has migrated to `.rex/prd_tree/`. On every folder-tree project the Completed Work section therefore found nothing and said so, with no error to explain it. It now asks rex two questions instead — `rex tree --format=json` for the PRD and `rex tree-diff --json` for what this branch completed — so no code path reads `prd.md` or `prd.json` for PR markdown.
  
  The collector's own copy of the completion diff is gone with it. "What did this branch finish" is rex's question, and it was previously answered by three implementations (the CLI, the dashboard's PRD delta, and this one) that were free to drift apart.
  
  `rex tree --format=json` is new: the machine-readable rendering of the same hierarchy `rex tree` prints, filtered identically. It is the folder-tree replacement for the `rex parse-md --stdin` seam that let a consumer outside rex read the PRD without a second parser.

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

- [#440](https://github.com/en-dash-consulting/n-dx/pull/440) [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91) Thanks [@endash-shal](https://github.com/endash-shal)! - Show what `ndx analyze`, `ndx plan` and `ndx recommend` are about to do, and what they did
  
  Run interactively, these three now print a preflight banner before they start:
  what the command reads, what it writes (and which writes need `--accept`),
  which phases call a model and why, and roughly how long it takes. It pauses
  briefly so you can Ctrl-C, then prints a closing summary of the files written,
  the LLM calls and tokens, the cost, and the command to run next.
  
  `ndx recommend` is declared as making no model calls at all, because it groups
  SourceVision findings deterministically — knowing which commands are free is
  the point of the banner as much as knowing which are not.
  
  The banner is skipped under `--yes`, `--quiet` and `--format=json`, in CI, and
  whenever stdout is not a terminal — so autonomous `ndx work` runs and piped
  invocations are unaffected. Both the banner and the summary go to stderr, so
  `--format=json` stdout is byte-identical either way. `NDX_PREFLIGHT=always`
  forces the banner when piping; `NDX_PREFLIGHT_PAUSE_MS` sets the pause.
  
  Supporting changes:
  
  - `rex analyze` and `rex recommend` now run under the shared monotonic progress
    reporter from `@n-dx/llm-client`, and rex's spinner registers with it like
    sourcevision's already did — so a rate-limit retry raised inside an LLM call
    pauses the spinner and prints its own line instead of corrupting it.
  - Cost is recorded by the tool that spends it, never recomputed by a reader:
    `sv analyze` writes `lastAnalysis.llm.costUsd` to the manifest (additive,
    optional), priced per task class at the model that answered; `rex analyze`
    adds `costUsd` to its `analyze_token_usage` log entry. The orchestrator
    cannot import the price table, and a second copy of it would drift — so where
    no cost was recorded the summary says "not recorded" rather than guessing.

- [#491](https://github.com/en-dash-consulting/n-dx/pull/491) [`161da3d`](https://github.com/en-dash-consulting/n-dx/commit/161da3d04bb668f80ffe1a52c3be880cdeafbab1) Thanks [@endash-shal](https://github.com/endash-shal)! - `verify_criteria` (MCP) no longer runs the repository's test command by default: `runTests` defaults to false, and even when true the command runs only once the repository's execution config is trusted (`ndx trust`). The criteria-to-test mapping is always returned; a skipped run says why.

- [#433](https://github.com/en-dash-consulting/n-dx/pull/433) [`083fa1c`](https://github.com/en-dash-consulting/n-dx/commit/083fa1c22ebdf7d86de03ecc7c59f437ae9d1bab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `rex log` / `ndx log` as a CLI route for `append_log`.
  
  `append_log` was reachable only as a rex MCP tool. Every `ndx work` run in a
  recent measured batch reported the same gap: the workflow's log step asks the
  agent to call it, but the rex MCP server was not connected to any of those
  sessions, and rex owns `execution-log.jsonl` under the write-access protocol,
  so hand-writing the file is not a substitute. Each run put the detail in its
  commit message instead.
  
  `rex log <event> [--item=<id>] [--detail="..."]` and the `append_log` MCP tool
  now build their entry through the same `appendExecutionLogEntry` and persist
  it via the same `PRDStore#appendLog`, so the two routes cannot diverge on
  shape, truncation (2,000 characters), or rotation (`execution-log.1.jsonl`
  past 1 MB). `ndx log` in `packages/core` spawns `rex log` — no rex import,
  same as every other delegated command.
  
  rex's default workflow and the `ndx-work` skill now name `ndx log` as the
  route when no rex MCP server is connected — the ordinary case for a
  `claude`/`codex` CLI-provider run.

- [#442](https://github.com/en-dash-consulting/n-dx/pull/442) [`f958d86`](https://github.com/en-dash-consulting/n-dx/commit/f958d865e70b66761f7c619b2b471601cc5ebc50) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `rex ready` to mark PRD items ready to work.
  
  An item qualifies when it has at least one `automated` or `metric`
  requirement — own or inherited from an ancestor — and no open blocker:
  status isn't `blocked`, and every `blockedBy` id is completed. Items already
  `completed`, `deferred`, `cancelled`, or `deleted` never qualify.
  
  With no `--item`, it walks the whole tree: qualifying items get
  `ready: true`, items that previously qualified but no longer do get the
  field cleared, and every item worth explaining (any qualifying item, plus
  any non-qualifying item that has a requirement of the right type) prints
  its verdict and reason. `--item=<id>` evaluates and marks a single item.
  `--format=json` prints the machine-readable form.
  
  `ready` is written only as `true` — a non-qualifying item has the field
  cleared rather than set to `false`, so its absence always means "not
  currently ready" rather than a stale positive. The field is purely
  informational: task selection (`rex next` / `get_next_task`) never reads
  it, so a tree that has never run `rex ready` — which is every tree today —
  selects exactly as it always has.
  
  Fixed a latent round-trip bug in the folder-tree serializer found while
  adding this: boolean frontmatter fields were always quoted
  (`JSON.stringify(String(value))`), and the parser checks for a quote before
  it checks for `true`/`false`, so a boolean silently came back as the
  *string* `"true"` instead of the boolean. `ready` is the first `PRDItem`
  field to exercise that path; booleans now emit unquoted.

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

- [#454](https://github.com/en-dash-consulting/n-dx/pull/454) [`d6a6c0c`](https://github.com/en-dash-consulting/n-dx/commit/d6a6c0c0d0f01674e58b8eddd9855909787b01fa) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Fix the branch guard, `rex tree-diff` and SourceVision's PR markdown in the cases the 0.8.0 B2 review found.
  
  - A stale `origin/HEAD` (one that still names a pruned branch, such as `origin/master` after a rename) is no longer trusted. The branch guard and a bare `rex tree-diff` check the ref exists and otherwise fall back to `main`/`master`, so a user on `main` is no longer refused on their own default branch.
  - `rex tree-diff` no longer runs the repository's git hooks when it extracts a tree at a ref, so a failing or slow `post-checkout` hook can't break it.
  - When the baseline ref predates the PRD tree, `rex tree-diff`'s text output now says so instead of listing every item as added.
  - `sv pr-markdown` warns when either side of the diff has no PRD tree, instead of rendering an empty or whole-project Completed Work section. It no longer forces a local `main` as the base: without an explicit base branch it uses tree-diff's default (`origin/HEAD`, then `main`/`master`) and reports the base tree-diff actually used.
  - hench's slug-migration offer and the dashboard's migration route no longer bypass the branch guard. On a feature branch they show rex's refusal, naming the branch.
  - `rex ready --item` without a value, including the space-separated `--item <id>`, now refuses and names `--item=<id>`, as `rex log` and `rex export` already do.

- [#445](https://github.com/en-dash-consulting/n-dx/pull/445) [`cceceb5`](https://github.com/en-dash-consulting/n-dx/commit/cceceb563ba1650f4e70b9cbe63eec9bbd954e4d) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx init` now starts new projects on the `.ndx/` layout
  
  A project with no n-dx state gets a single `.ndx/` container holding `rex/`,
  `hench/`, `sourcevision/` and `config.json`, instead of three dot-directories
  and a `.n-dx.json` scattered across the root. `.mcp.json` stays at the
  repository root, because the vendor CLIs read it there.
  
  A project that already has n-dx state keeps the layout it has. Re-running init
  is how people pick up new assistant surfaces and repaired config, and it must
  not turn into a migration nobody asked for — moving an existing project is
  `ndx migrate-layout`'s job, where it can snapshot first and `git mv` so history
  follows.
  
  The mechanism is that init creates the container before it spawns the sub-CLIs,
  so each one resolves its own paths and they cannot disagree. Alongside it, the
  paths that `ndx init` writes and that every later command reads now come from
  the resolver rather than from literals: the project and package config files,
  the `requireInit` check, the `.gitignore` and `.gitattributes` blocks, the git
  baseline commit, and hench's own state directory across its CLI.
  
  `relativeToRoot(layout, path)` is new in `@n-dx/llm-client` (and its
  orchestration-tier twin), for the several places that need a resolved path as
  `.gitignore` spells it — root-relative, forward slashes.
- Updated dependencies [[`66705e6`](https://github.com/en-dash-consulting/n-dx/commit/66705e69a1d66651644ef9a5f5ff684669ebf2e9), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`05a8115`](https://github.com/en-dash-consulting/n-dx/commit/05a811560a19baf95e69bc19a8c906dad2b3fea9), [`39c6d80`](https://github.com/en-dash-consulting/n-dx/commit/39c6d80441aba2c3dd71d94494b58bf42fc5a4a0), [`29c576a`](https://github.com/en-dash-consulting/n-dx/commit/29c576a196ed033d77a35a2dd87952ca6f32902f), [`ccad056`](https://github.com/en-dash-consulting/n-dx/commit/ccad05698ce562b0ae47b283a59854b299884f5c), [`0e3623e`](https://github.com/en-dash-consulting/n-dx/commit/0e3623edbc25e417982a93db53aa7ae6b70fae2f), [`2b144b8`](https://github.com/en-dash-consulting/n-dx/commit/2b144b897262afc597ab9e964febb6cd6c7d9f91), [`aa0ca02`](https://github.com/en-dash-consulting/n-dx/commit/aa0ca024713788ec46248f12df84e7390c64e2c7), [`1bcd1e2`](https://github.com/en-dash-consulting/n-dx/commit/1bcd1e25c063cb34a6bba3615b55a7d25adc4fef), [`d3c2169`](https://github.com/en-dash-consulting/n-dx/commit/d3c21692f2a8f7582a114fc69fba1c88a7a0205e), [`161da3d`](https://github.com/en-dash-consulting/n-dx/commit/161da3d04bb668f80ffe1a52c3be880cdeafbab1), [`0bca3ea`](https://github.com/en-dash-consulting/n-dx/commit/0bca3ea0f0336ec4f317504fb518320c6ac6856d), [`03590e4`](https://github.com/en-dash-consulting/n-dx/commit/03590e4fa8069232774dce4e1d0fe460b969e530), [`66705e6`](https://github.com/en-dash-consulting/n-dx/commit/66705e69a1d66651644ef9a5f5ff684669ebf2e9), [`ccad056`](https://github.com/en-dash-consulting/n-dx/commit/ccad05698ce562b0ae47b283a59854b299884f5c), [`cceceb5`](https://github.com/en-dash-consulting/n-dx/commit/cceceb563ba1650f4e70b9cbe63eec9bbd954e4d)]:
  - @n-dx/llm-client@0.8.0

## 0.7.2

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.7.2

## 0.7.1

### Patch Changes

- [#392](https://github.com/en-dash-consulting/n-dx/pull/392) [`ee16578`](https://github.com/en-dash-consulting/n-dx/commit/ee165780ecdc34ad0349ab7028875f04bff769e0) Thanks [@endash-shal](https://github.com/endash-shal)! - A refused completion no longer hands the task back to other worktrees, and claims can now be inspected and freed from the CLI.
  
  When the uncommitted-work gate refuses to mark a task complete, the run's cross-worktree claim is held instead of released: the work is real and it is in that worktree, so freeing the task invited a second worktree to redo it. A held claim records why it is held, survives its holder's exit (an ordinary claim dies with its pid), and does not expire — it ends only when someone deals with the work: `ndx claim release <id>`, `release --all` from the worktree that left the work, `release --force`, or a fresh claim from that worktree (a re-run there clears the hold). Another worktree passes the task over; `hench run` and the dashboard's Execute, asked for it explicitly, say the task is held, that the hold does not expire, and how to clear it, rather than "is being worked on". Ordinary claims keep their existing lease-and-pid liveness exactly as before.
  
  New `ndx claim` (`rex claim`): `list` shows every live claim with task title, worktree, holder liveness, state and expiry (a held claim reads `expires: never — held until released`); `release <taskId>` frees one — from whichever worktree the operator is standing in when the claim is held or its holder is dead — refusing while the holder is alive unless `--force`; `release --all` frees this worktree's held and dead-holder claims, keeping any a live run is still working unless `--force`. `--format=json` throughout.

- [#394](https://github.com/en-dash-consulting/n-dx/pull/394) [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx usage` counts hench runs, not turns. The By-command breakdown summed one call per turn and printed it as "runs", so a batch of 10 runs could report 1,851 — disagreeing with the By-package line for the same tokens. Hench usage now carries both counts: `runs` (distinct run records, printed as the human unit) and `calls` (LLM calls, i.e. turns, kept in `--format=json` so nothing downstream loses the turn count). Package, per-command, and per-period surfaces all report the same run count for the same data.

- [#394](https://github.com/en-dash-consulting/n-dx/pull/394) [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard prices token usage per model and shows the split. Its aggregation now carries a `byModel` split (from hench turn records, the rex execution log, sourcevision, and the dashboard's own Ask ledger) and prices it through rex's `estimateCostFromTotals` — imported via the rex gateway, so there is one copy of the pricing arithmetic and both surfaces quote the same figure for the same runs. The Token Usage view gains a Cost by Model table (input/output/cache write/cache read/cost per model, with unknown ids labelled "priced as claude-sonnet-5" and an unattributed line for model-less tokens) and drops its hardcoded per-million rate labels. Also fixes `ndx usage`'s headline undercount: the package rollup now counts `smart_add_token_usage` events, which its own By-command breakdown (and the dashboard) already included.

- [#384](https://github.com/en-dash-consulting/n-dx/pull/384) [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex validate`'s "tree slug convention" check is now an error, not a warning: a PRD tree written by a foreign slug rule means the next write will rewrite it, so it must fail validation and CI rather than pass silently. Its closing line now says to run `rex migrate-slugs` on the default branch.

- [#413](https://github.com/en-dash-consulting/n-dx/pull/413) [`fdb8376`](https://github.com/en-dash-consulting/n-dx/commit/fdb8376fa554f7ef92c65e3819def5dbbf74e933) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A hench run no longer leaves its task `completed` when the full test gate fails. The agent still marks its own task completed, but while the run holds the task's claim, rex records that request on the claim instead of writing it, for rex MCP (Claude CLI, Codex CLI, or the dashboard's HTTP server), `rex update`, and the API loop's `rex_update_status` alike. The agent's `git add -A && git commit` therefore cannot carry the status into the work commit. hench applies the completion, with the agent's resolution type and detail, once the gate passes — in its own record commit on `autoCommit`, or before the commit prompt otherwise. When the gate fails, the task stays not completed and the resolution is kept on the run record (`completionHold`) and in the execution log for the retry. Review repairs from a failed gate are committed as their own commit on `autoCommit`, and named as left uncommitted otherwise. Inside the run, the agent's own MCP server can no longer take over or release the run's claim, so it cannot drop the hold (`rex claim release --force` still can). Outside a hench run, MCP and the rex CLI behave as before. The hold is recorded by rex, so it engages only where the agent's rex includes this change. A Claude CLI run launched through `ndx` pins the agent's rex MCP server to the run's own build; the agent's shell `rex`, a Codex run's MCP server, and a Claude run that cannot pin (a standalone `hench run`) still use the `n-dx` on PATH. The API loop's `rex_update_status` runs inside hench, so it always holds.
  
  A failed gate's record now names the failing test. `testGate.failureDigest`, which is also printed and copied to `diagnostics.testGateFailureDigest`, holds the FAIL lines, the first assertion blocks and the per-suite summary, extracted from the whole output so that a long stderr stream from passing suites cannot push them out.
  
  The timeout already killed the whole test process tree (llm-client `exec`'s tree kill). A timed-out gate now reports when the kill took effect ("the whole process tree was gone 0.4s after the kill began"). When hench itself reached the deadline late, the delay is reported as a stall of this process rather than charged to the kill. A signal from outside hench and runaway output are no longer reported as timeouts. The gate's output ceiling rises from 5 MB to 32 MB, so a large suite's failure summary is not cut off.

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

- [#416](https://github.com/en-dash-consulting/n-dx/pull/416) [`e70e787`](https://github.com/en-dash-consulting/n-dx/commit/e70e787b40ada9ecaf17069b7e4f11246ebb235f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex validate --post-merge` reports a `## Children` table that disagrees with its own directory
  
  A feature reached `main` with four children missing from its Children table and was repaired by hand twice before anything noticed. A fixture test now settles what that state costs: nothing. The parser walks the directory and never reads the table, so the omitted items load normally, survive a full-tree save, and the save rewrites the table complete. The shape is cosmetic — but it still makes the tree lie to anyone reading it as documentation, and it was invisible.
  
  `children-table-out-of-sync` reports it, in both directions (a child on disk that no row lists, and a row pointing at a file that is gone). It is repairable — `--repair` rewrites the table from the directory — so the CI gate reports it without blocking the merge.
  
  Two corrections came out of building it. Link targets are read as each row's last `](…)` rather than by matching a `[label](target)` pair, because titles are not escaped into the label and a real item titled "Color-code [Tool], [Agent], …" would otherwise read as unlisted. And the tree-root banner `index.md` written by `rex init` is skipped, since it has no frontmatter and is not an item — every epic in the tree would otherwise read as an unlisted child of it.
  
  `docs/architecture/prd-folder-tree-schema.md` said tasks never carry a Children table (contradicting its own compatibility matrix and the serializer) and described the child link format as `./{slug}/{title}.md` (the serializer writes `./{slug}.md` or `./{slug}/index.md`). Both corrected.

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

- [#384](https://github.com/en-dash-consulting/n-dx/pull/384) [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The PRD tree now records which slug rule wrote it, and a build that implements a different rule refuses to write it.
  
  `tree-meta.json` gains a `slugRule` integer beside `title` and `schema`, sourced from a single `SLUG_RULE_VERSION` constant declared next to the slug functions. Every save checks the marker before writing a single file: a different version refuses the whole save, naming both versions and `rex migrate-slugs`; an absent marker is adopted only if the tree's paths already conform, and refused otherwise. `rex validate` reports a marker mismatch as an error, which catches a tree written by a *future* rule — one whose paths this build cannot derive and so cannot inspect.
  
  `rex migrate-slugs` is the one command that may re-slug a tree, and it sets the marker in the same locked write. Older builds ignore the unknown key, so a marked tree still loads everywhere.

- [#384](https://github.com/en-dash-consulting/n-dx/pull/384) [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx work` and the dashboard's Execute now refuse to start against a PRD tree written under a different slug rule, instead of discovering it at the completion write.
  
  An autonomous run writes the PRD when it finishes its task, so a run started with a mismatched build does not fail — it succeeds, and carries a whole-tree re-slug into whatever branch is open under a "task completed" commit. The store's write guard refuses that write, but only after the run has claimed the task, spent its tokens and edited the code.
  
  Both surfaces now ask the question first, through rex's new `checkTreeConformance`: the CLI refuses before taking a claim or writing anything (including on `--dry-run`, so a preview cannot report that the real run would have been fine), and `POST /api/hench/execute` answers 412 with the same message, which the viewer already surfaces on the run card. Unlike the write-time guard, a tree whose marker agrees is still path-scanned, so one whose paths were disturbed is refused too. There is no override flag: the fix is `rex migrate-slugs`, or upgrading rex when the tree was written by a newer rule. An interactive `ndx work` or the dashboard can offer to run the migration for you and then stop without executing the task.

- [#395](https://github.com/en-dash-consulting/n-dx/pull/395) [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Removed the test-only `writePRD` option `omitSlugRuleMarker` (`tests/helpers/rex-dir-test-support.ts`): nothing called it, so the absent-marker branch it existed to reach was never exercised through it — the branch is already covered directly in `tests/unit/store/slug-rule-guard.test.ts`, which writes `tree-meta.json` without the marker on disk. No production code changed.

- [#391](https://github.com/en-dash-consulting/n-dx/pull/391) [`bb4f829`](https://github.com/en-dash-consulting/n-dx/commit/bb4f829b0d676024fce715ee5da4db0ed2a429b5) Thanks [@endash-shal](https://github.com/endash-shal)! - `rex fix` no longer inverts timestamps when backfilling `startedAt` on completed items ([#375](https://github.com/en-dash-consulting/n-dx/issues/375)). The backfill now derives from the item's own `completedAt` — never the current clock, which produced `startedAt > completedAt` on anything completed before today. Already-inverted pairs are now a detectable, repairable issue (new `inverted_timestamps` fix kind): the repair clamps `startedAt` back to `completedAt`, so trees damaged by the old backfill heal in one `rex fix` run.

- [#404](https://github.com/en-dash-consulting/n-dx/pull/404) [`5866f4e`](https://github.com/en-dash-consulting/n-dx/commit/5866f4eddf660fb4d254dd9a6e66e1fbc4aae7d7) Thanks [@endash-shal](https://github.com/endash-shal)! - Hench's completion and `--reset-deferred` commits stage the PRD files the save actually touched, not the whole tree
  
  Staging `.rex/prd_tree/` wholesale once swept a 1,378-file in-flight rename
  into a "task completed" commit. The serializer always knew exactly which files
  each save wrote and deleted; that list now crosses the package boundary.
  
  - `@n-dx/rex` — every folder-tree save records the paths it wrote and
    deleted (`SerializeResult.writtenPaths`/`deletedPaths`; files
    skipped as unchanged are not listed, and a removed directory is reported as
    the files inside it). Both local stores accumulate the lists across saves
    and expose them, relative to the project directory, through the new
    `takeSaveFileReport(store)`, which drains
    the accumulator — a caller that saves several times between commit points
    (`--reset-deferred` saves once per task) gets the union, not the last save.
  - `@n-dx/hench` — the completion-metadata commit and the `--reset-deferred`
    commit build their `git add` list and commit pathspec from that report plus
    the `tree-meta.json` sidecar. An operator's unrelated dirty file under
    `.rex/prd_tree/` is no longer staged or committed by either; it stays dirty
    in the working tree for the operator to own. A deleted file is staged only
    when git tracks it, and a written file only while it still exists, so the
    staging loop cannot abort on a missing path. Stores that do not report
    saves keep the previous wholesale staging.

- [#395](https://github.com/en-dash-consulting/n-dx/pull/395) [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex migrate-slugs` decides whether a tree is adoptable against the marker it reads inside the PRD lock, immediately before the write, rather than against one read before the lock was taken. A concurrent writer that records a newer marker in that window therefore cannot have it silently overwritten by the migration — exactly the whole-tree downgrade the direction check exists to prevent.
  
  This holds in both local stores. `FileStore` is the one that matters in practice: `resolveStore` returns it, and `rex migrate-slugs` resolves its store through `resolveStore`, so it is the path every real migration takes.

- [#384](https://github.com/en-dash-consulting/n-dx/pull/384) [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The slug-rule write guard judges an unmarked tree by the paths already on disk, not by the slugs the pending save implies, so a write that renames an item (`rex update <id> --title="…"`) is never mistaken for a foreign build's re-slug. A genuinely foreign unmarked tree is still refused.
  
  `rex migrate-slugs` is bounded to the direction it can actually migrate. It rewrites the tree under this build's rule, so on a tree marked with a *newer* rule it would perform a downgrade — and since the newer build would then refuse the tree and advise the same command, two builds could trade whole-tree renames by following their own instructions. `adoptSlugRule` refuses a newer marker, and the guard's refusals recommend upgrading rex rather than migrating when the tree is newer. A migration that only recorded the marker says so rather than reporting that nothing changed, and refusal sample lines use the platform path separator.

- [#404](https://github.com/en-dash-consulting/n-dx/pull/404) [`5866f4e`](https://github.com/en-dash-consulting/n-dx/commit/5866f4eddf660fb4d254dd9a6e66e1fbc4aae7d7) Thanks [@endash-shal](https://github.com/endash-shal)! - A PRD save no longer risks refusing to clean up its own previous write
  
  The stale-save guard judges deletion candidates by mtime against the
  `loadedAt` the store adopted after its last save. That `loadedAt` was a bare
  `Date.now()` taken after the files were written — and on Windows the
  filesystem clock can run ahead of `Date.now()` by more than the guard's
  tolerance, so a store's next save intermittently read its *own* just-written
  files as another writer's newer work and refused. The serializer now reports
  the largest mtime it wrote (`SerializeResult.maxWrittenMtimeMs`) and both
  local stores adopt `max(Date.now(), that)` instead.
- Updated dependencies [[`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`fdd864c`](https://github.com/en-dash-consulting/n-dx/commit/fdd864c4db245e5d69a0ae78534f07c0cc752c0e), [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396)]:
  - @n-dx/llm-client@0.7.1

## 0.7.0

### Minor Changes

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a cross-worktree task claims store, `openClaimsStore(projectDir)`, kept at `<git common dir>/ndx/claims.json` so every worktree of a repository sees the same claims (and git never tracks it). A claim carries the task id, the worktree root, the holder's pid, host and expiry (default 4 h); it is live while the pid exists and has not expired, and dead or expired claims are ignored by readers and pruned by the next writer. Writes hold an advisory `claims.lock` and land by atomic rename, so two processes claiming at once see one winner. Outside a git repository the store is a no-op and behaviour is unchanged.

### Patch Changes

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

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Calibrate the uncommitted-work guards so autonomous runs stop refusing their own PRD writes.
  
  Three defects, all of which made a run refuse on dirt its own code had just
  produced.
  
  **The between-task guard stopped every loop at its first failed task.** It
  discounted nothing but hench's runtime artifacts, on the premise that an
  uncommitted `.rex/prd_tree/` meant the previous task's status write never
  landed. That only holds for a task that *succeeded*: every failure path writes
  a `deferred`/`pending` status and commits nothing, because both committers run
  only for a completed run and the rollback never reverts unattended. So the
  first deferred, failed or timed-out task stopped the loop outright, and the
  consecutive-failure counter and stuck-task skipping were unreachable. The
  guard now discounts the PRD paths; the completion gate in `finalizeRun` still
  covers the case that is real leakage.
  
  **`.rex/tree-meta.json` refused every completion.** Every folder-tree save
  rewrites the tracked sidecar, and where the committed copy predates the schema
  marker the rewrite changes its bytes. It is not a hench runtime artifact and
  not under `.rex/prd_tree/`, so it was discounted by neither gate and staged by
  neither committer — the first PRD write of any run left it dirty and the
  completion gate refused every task from then on. It is now a PRD commit path
  everywhere the tree is, off a single `TREE_META_FILENAME` constant exported by
  rex so the staging, discounting and skipping sites cannot drift apart.
  
  **`--epic-by-epic` had no between-task guard at all.** It iterates tasks in its
  own loop, which was never wired to the guard, so the work-tangling the guard
  exists to prevent still happened there. It now runs the same check before every
  task but the first of the invocation, counted across epics.
  
  Also fixes the porcelain reader underneath all three. `git status --porcelain`
  output was split with `output.trim()`, which strips the leading space of the
  *first* line only — and that space is the blank index column of an unstaged
  change. The first entry's path parsed one character short, matching no discount
  rule, and its worktree column was read as the index column, so a ` M` file
  masqueraded as staged and was discounted outright. Whichever entry git listed
  first was the one corrupted, which is why it looked intermittent.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Completion no longer cascades over an in_progress parent or outside the run's subtree ([#368](https://github.com/en-dash-consulting/n-dx/issues/368))
  
  A run that hit the account session limit on turn 1 — status failed, 1 turn,
  zero tool calls, no changes; the agent never ran — nonetheless closed a task
  and an epic belonging to another user, in an epic it had never touched, and
  rewrote `lastModifiedBy` on both to whoever was running the command. The task
  was an open investigation with unmet acceptance criteria whose single subtask
  happened to be completed. It was caught only because the run left the tree
  dirty and someone read the diff.
  
  Three independent things had to be true for that to happen, and all three are
  now fixed:
  
  - **An `in_progress` parent is no longer auto-completed by a child
    transition.** `AUTO_COMPLETABLE_STATUSES` is `{pending}`;
    `in_progress` is a deliberate claim that the parent has work of its own.
    `remove-task.ts` now imports that set rather than keeping a second copy.
    `rex status`'s auto-completable *hint* still lists `in_progress` parents, so
    one that really has finished is surfaced for a human to confirm.
  - **A cascade cannot leave the subtree the run is operating on.**
    `reconcileAutoCompletions` takes `{ ancestorsOf }`, which confines its
    whole-tree self-healing sweep to that item's ancestor chain; an unrecognised
    id contains it to nothing rather than degrading to a full sweep. Hench's
    `rex_update_status` passes the task it was asked to update.
  - **A cascade no longer rewrites authorship.** New
    `WriteOptions.preserveModifiedBy` keeps an item's existing `lastModifiedBy`
    while still stamping `lastModified`; every cascade write site (hench's tool,
    `rex update`, the `update_task_status` MCP tool, `rex remove`) sets it. Both
    local stores and all four remote adapters honour it, and it survives the
    transaction-level stamp in `stampChangedItems`.
  
  This is distinct from [#364](https://github.com/en-dash-consulting/n-dx/issues/364), which narrowed which *child* statuses count as
  done. Here the child genuinely is completed, so that predicate was satisfied
  and the cascade still fired. Both guards are needed; the module header of
  `core/parent-completion.ts` records why they must not be merged.
  
  Also declares `lastModified` / `lastModifiedBy` on `PRDItem`. Both were
  already written by every store adapter but reached readers as `unknown`
  through the index signature.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix cross-worktree task claims under the dashboard and hub MCP endpoints. A
  claim's owner is now its worktree alone; the pid is only a liveness check.
  `ndx start` runs one rex MCP server per workspace inside a single process, so
  every worktree's claim carried that one pid — and an ownership test that
  accepted a matching pid let two worktrees hold the same task, let either
  release the other's claim, and silenced the dashboard's own "another worktree
  is working on this" refusal. `ClaimsStore.release` and `isClaimedByOther` now
  take the asking worktree rather than a pid.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Ensure retried PRD snapshots cannot retain entries from failed partial copies.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Task selection is claim-aware across worktrees. `hench run` (what `ndx work` spawns) claims the task it selects — before the brief and any LLM turn — and releases it when the run ends (completed, failed, cancelled by Ctrl-C, or thrown); an explicit `--task` another worktree holds is refused with the holder's worktree, and a retry in the worktree that already holds a task takes the claim over. `rex next`, the `get_next_task` MCP tool and hench's autoselection pass over tasks other worktrees hold (`skippedClaimed` in JSON output, one line per task under `--verbose`), and `findNextTask` / `findActionableTasks` accept `excludeIds`. The dashboard's execute route answers 409 with `claimedBy` when another worktree holds the task. Outside a git repository nothing changes.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Share the update-stamping rule across the six store adapters, and stop `rex next`
  calling a deferred child "completed".
  
  Every `updateItem` implementation carried a pasted copy of the same three lines:
  merge `updates` onto the existing item, then stamp it, choosing the author with
  a `options?.preserveModifiedBy ? existing.lastModifiedBy : undefined` ternary.
  Six copies — the folder-tree store, the Asana, Jira, GitHub Projects and Notion
  adapters, and a partial-update variant in the file adapter, which had already
  diverged. `stampUpdatedItem` and `stampUpdatedFields` in `core/sync.ts` now hold
  it once, over a single private `updateActor` rule, so the `preserveModifiedBy`
  behaviour ([#368](https://github.com/en-dash-consulting/n-dx/issues/368)) can be corrected in one place.
  
  `explainSelection` announced "all children completed, ready to finalize" off an
  inline `completed || deferred` check. That is the [#364](https://github.com/en-dash-consulting/n-dx/issues/364) misreport exactly: [#364](https://github.com/en-dash-consulting/n-dx/issues/364)
  narrowed `SUCCESSFUL_CHILD_STATUSES` to `{completed}` precisely so a deferred
  child would stop counting as done, and this copy was missed. It now calls
  `allChildrenSuccessful`, so a parent with a deferred child is described at its
  priority rather than as ready to finalize.
  
  No behaviour change beyond that one summary line.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Fall back to atomic directory lock publication on filesystems without hard-link support.

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - fix(rex): close two cross-process TOCTOU holes in the PRD file lock
  
  Follow-up to the dead-PID-only staleness fix: auditing the flaky
  `import-bundle-transaction` failure surfaced two remaining ways a live
  writer's lock could be deleted under full-suite load, each admitting a second
  writer into the critical section — the exact lost-update the stale-save guard
  keeps catching.
  
  - **Mid-creation reads.** `tryAcquire` creates the lock with `writeFile(…,
    {flag:"wx"})` — open, then write. A waiter reading between the two syscalls
    saw an empty file, decoded it as "malformed = stale", and unlinked a live
    writer's lock. Malformed is now confirmed after a 100ms grace re-read: a
    corpse stays malformed, a mid-creation lock becomes valid.
  
  - **Cleanup races.** Two waiters could both judge the same corpse stale; the
    faster one unlinked it and created its own lock, and the slower one's
    unlink then landed on the fresh lock. Stale removal is now claim-by-rename
    to a waiter-unique tombstone (exactly one racing rename succeeds) with
    content verification against the bytes the staleness judgment was made on —
    a removal armed with a stale judgment can no longer delete a lock that has
    since been replaced.
  
  Both paths are pinned by new unit tests in `file-lock.test.ts`, including the
  late-cleaner regression and the mid-creation window frozen in place.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `rex fix` now reopens parents to `pending` and can heal stuck parents.
  
  Two follow-ups from the PR [#370](https://github.com/en-dash-consulting/n-dx/issues/370) review:
  
  - **Reopen to `pending`, not `in_progress`.** Since [#368](https://github.com/en-dash-consulting/n-dx/issues/368) made `in_progress` an explicit claim that auto-completion refuses to touch, a parent the repair tool reopened to `in_progress` could never close again when its last child finished. `rex fix` now uses the codebase's reopen convention, matching `cascadeParentReset`.
  - **`fix/` shares the real child predicate.** It kept a private terminal-status set that still counted `deferred` as done, so `rex validate` warned about a completed parent with a deferred child while `rex fix` proposed nothing for it. Both now read `SUCCESSFUL_CHILD_STATUSES`, so fix repairs exactly what validate warns about.
  - **New `stuck_parent` fix kind.** A `pending` parent whose children are all `completed` is now completed (with `completedAt`), bottom-up. This is the operator-facing path to the whole-tree reconciliation that agent runs stopped performing when [#368](https://github.com/en-dash-consulting/n-dx/issues/368) scoped every run-path sweep to the run's own ancestors.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - PRD lock release now deletes only on positive proof of ownership. It previously
  unlinked the lock whenever its content failed to decode, which would remove a
  replacement lock published by a build whose lock shape this one cannot parse —
  an unlink of a live foreign holder, from the one code path in the module that
  still deletes a lock it had not verified as its own. Undecodable content is
  absence of evidence, not evidence of ownership, so such a lock is now left in
  place for the same manual cleanup every other unowned lock gets.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Do not auto-complete an epic that still has deferred, blocked, or failing children ([#364](https://github.com/en-dash-consulting/n-dx/issues/364))
  
  Auto-completion treated `deferred` as terminal alongside `completed`, so an
  epic with a deferred child could be reported done while the work was not.
  That happened live: an epic was marked completed with three of five children
  in `deferred` after a session-limit interruption, while one of the deferred
  tasks left a half-finished MCP-registration migration in place — reported as
  done.
  
  Auto-completion now treats only `completed` as a successful terminal state.
  `deferred`, `blocked`, and `failing` children all block a parent from
  auto-completing. The predicate (`SUCCESSFUL_CHILD_STATUSES` /
  `allChildrenSuccessful` in `core/parent-completion.ts`) is now the single
  source of truth, reused by `findAutoCompletions`, `reconcileAutoCompletions`,
  `removeTask`'s post-removal auto-completion check, the `rex status`
  auto-completable section, and the structural health check that flags a
  completed parent with non-terminal children.
  
  Also closed a related gap: `findAutoCompletions` unconditionally treated its
  triggering item as done, even when that item's own new status was `deferred`
  rather than `completed` — reintroducing the same bug through a different
  path. It now only seeds the cascade when the triggering item actually
  completed successfully.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Publish PRD lock files atomically so concurrent writers cannot enter the same
  critical section.
  
  The lock was created directly with `writeFile(..., {flag: "wx"})`, which made
  its public name visible before the JSON body was written. A competing process
  could read that transient empty file as malformed, reclaim the live lock, and
  write alongside its owner. Lock acquisition now writes the complete body to a
  unique sibling file and atomically links it into place; an existing public lock
  still reports contention through `EEXIST`.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Stop automatically deleting stale PRD lock files because a concurrent writer can replace the inspected lock before path-based cleanup runs. Crashed-writer locks now fail loudly with the existing manual-cleanup guidance.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Retry lock acquisition when a contending lock is released during inspection.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `rex fix` now repairs nested parent/child misalignment in one run. On epic(completed) → feature(completed) → task(pending) it judged the epic while the feature still read `completed`, so it reopened only the feature, reported "Fixed 1 issue", and left the epic completed above a pending child — the very inconsistency it exists to find, needing a second run to reach the epic and a third to confirm clean. Misalignment is now decided bottom-up, reading each child's status as the same pass will leave it, so every falsely-completed ancestor is found together and the dry-run plan matches what the run does however deep the nesting goes.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix a PRD-lock race that let two concurrent writers interleave.
  
  `acquireLock` creates the lock file with `O_EXCL` and then writes its JSON, so
  for a microsecond the lock file exists but is empty. A second process that hit
  `EEXIST` and read it in that window got `""`, and `isLockStale` treated
  unparseable content as stale — so it unlinked the live writer's lock and
  entered the critical section alongside it. Two concurrent `rex import-bundle`
  runs then interleaved and the second save was rejected by the stale-save guard
  ("this save would delete 1 item written after the document being saved was
  loaded"), the intermittent `pnpm test` failure tracked as the rex flake.
  
  `isLockStale` no longer treats an empty or unparseable lock as stale: a lock
  mid-creation becomes readable within a retry, and a genuinely corrupt one keeps
  failing to parse so the waiter times out loudly (naming the file to delete)
  rather than interleaving silently — the same "reclaim only on proof the owner
  is gone" rule the dead-PID path already follows. Reproduced 1-in-~15 before,
  0-in-60 after; two regression tests pin that an empty and a garbage lock file
  are waited on, not stolen.

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Make next-task parent selection use the shared completed-child predicate.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `SelectionExplanation` now carries a machine-readable `reason` (`in_progress` | `ready_to_finalize` | `priority`) alongside its rendered `summary`. Hench's task header branches on that code instead of substring-matching rex's prose, so rewording the summary no longer silently degrades a finalize-ready parent's label to "medium priority".

- [#370](https://github.com/en-dash-consulting/n-dx/pull/370) [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59) Thanks [@ryrykeith](https://github.com/ryrykeith)! - PRD tree snapshots no longer abort when another process is mid-write.
  
  `snapshotPRDTree` copies `.rex/prd_tree/` before the PRD lock is taken, so a
  concurrent writer can change the tree under it. An atomic writer's
  `<file>.<pid>.<uuid>.tmp` that existed when `cp` read the directory and was
  renamed away before it stat'd the entry raised `ENOENT`, and the snapshot guard
  turned that into a refused command — `rex import-bundle` failing because some
  unrelated process had finished a write.
  
  The copy now filters those temp files out of the walk (they are not PRD content
  and must never appear in a rollback point), and re-walks the tree if any other
  entry vanishes mid-copy, so a save's stale-directory sweep cannot fail a
  snapshot either. A persistent error still fails loudly rather than producing an
  incomplete rollback point.
  
  The temp-path shape is now built and recognised by one pair of helpers next to
  the atomic writer (`atomicWriteTempPath` / `isAtomicWriteTempPath`), replacing
  three hand-rolled copies of the same template string.

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - Stale-save guard: a relocation cleanup must match the file's load-time identity
  
  The guard's relocation exemption admitted any newer deletion candidate whose item id
  appeared in the document being saved. That covered same-writer leaf-to-folder promotion,
  but also let a stale mover delete a source file another writer had edited since the
  snapshot loaded — the stale copy landed at the destination and the edit was lost with no
  error. `parseFolderTree` now records a content digest per item file, `serializeFolderTree`
  accepts it as `loadedFiles` and requires the source file to still match before allowing
  the relocation, and returns fresh digests after each save so a same-writer follow-up save
  needs no reload. Both stores carry the map between load and save.

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - fix(rex): stale-save guard no longer fires on same-writer leaf promotions
  
  Root cause of the intermittent web-route 400s (`capture-next-steps`,
  `capture-ask`, `accept-edited` flaking under the full suite): the stale-save
  guard judged deletions by mtime alone. When a handler adds an epic and then
  its first child in back-to-back transactions, the promotion from `<slug>.md`
  to `<slug>/index.md` removes a file the same writer created milliseconds
  earlier — and under Windows timestamp granularity that leaf's mtime can
  postdate the second transaction's load, so the guard vetoed a save that
  deleted nothing and the route returned 400.
  
  The guard now flags an entry only when it contains a file that is both newer
  than the load AND carries an item id absent from the document being saved —
  a relocation keeps its item, a genuine concurrent write does not. Newer files
  with no parseable id stay protected by mtime alone, and directory mtimes are
  ignored (they bump on any child rename and identify nothing). All existing
  guard contracts hold; the promotion case and the id-absent case are pinned by
  new tests with the pathological clock frozen in place via `utimes`.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `rex status` no longer tells you to run `rex fix` for parents `rex fix` will not touch. The auto-completable hint now splits pending parents (which `rex fix` closes) from `in_progress` ones (an explicit claim only a human should close), so a PRD whose only auto-completable parents are `in_progress` gets the `rex update` instruction instead of a repair that reports "No issues found."

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - feat(rex): `rex status` (and `ndx status`) shows the last work cycle
  
  The status tree now ends with a "Last work cycle" section: which tasks the
  most recent `ndx work` / `--auto` / `--loop` invocation completed, failed
  (labelled with timeout / budget exceeded / transient error where that is the
  reason), and skipped (cancelled), plus a counts line. Previously the operator
  had to dig through `.hench/runs/` JSON or `.run-logs/` to reconstruct what
  the last cycle actually did.
  
  The section is derived from the run records hench already persists under
  `.hench/runs/` — read as data files, following the precedent in
  `core/token-usage.ts` — so history survives across sessions with no new
  state. Records carry no batch id, so a cycle is reconstructed from timing:
  runs cluster while the gap from one run's finish to the next run's start
  stays within 30 minutes (loop pauses are seconds; separate invocations are
  usually hours apart).
  
  Human tree view only — the JSON, `--quiet`, `--tree`, and `--group-by`
  output contracts are unchanged, and a project with no run history shows no
  section at all.
- Updated dependencies [[`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d)]:
  - @n-dx/llm-client@0.7.0

## 0.6.0

### Patch Changes

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Insert an `analyze --accept` batch in one transaction, so it stops failing its own stale-save guard.
  
  Acceptance called `store.addItem` once per item, so accepting N items ran N
  transactions and serialized the whole folder tree N times. Every intermediate
  shape reached disk — and one of them is destructive to clean up. An epic
  inserted before its first feature has no children, so the serializer writes it
  as the leaf `general.md`; the transaction that adds that feature must then
  DELETE the leaf to promote the epic to `general/index.md`.
  
  The stale-save guard weighs every such deletion against the transaction's own
  load time, with a 2 ms tolerance. Measured on Windows, the leaf's mtime lands
  just 0.57–2.04 ms before the next transaction's load — inside the window, but
  with almost nothing to spare. Under the I/O pressure of the full monorepo suite
  the write timestamp drifts past it, and the accept aborts with
  
      Stale-save guard: this save would delete 1 item written after the document
      being saved was loaded
  
  naming `prd_tree/general.md` and warning that another writer's work was about to
  be destroyed. It was its own, one transaction earlier. This reproduced 2/2
  through `scripts/run-all-tests.mjs` and passed 2/2 with the rex suite alone,
  so it presented as flake rather than as a bug in the accept path — that runner's
  header already refers to "rex's load-sensitive tests".
  
  Proposals are now built into fully-nested epics up front and pushed in a single
  `store.withTransaction`, which is what the guard's own error message advises.
  One write emits the final shape, so the intermediate leaf is never created and
  there is no deletion to weigh. Verified with a filesystem watcher over a real
  accept: only `general/`, `general/index.md` and the feature file are touched.
  Item stamping (`withSelfHealTag` then `stampModified`) is preserved per item and
  now happens outside the lock, since resolving the actor can shell out to git.
  
  This is the write path the surrounding "move file lock to saveDocument" work
  missed — it converted `reorganize`, `prune` and `reshape`, but not
  `analyze --accept`. Accepted counts, batch-record output and the
  `analyze_accept` execution-log entry are unchanged.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Reject a PRD bundle whose dependency graph cycles or whose nesting is illegal.
  
  `parseBundle` held items to `validateDocument`, which is a field-shape check.
  Two whole-tree faults passed straight through it and into the tree:
  
  A `blockedBy` cycle imported cleanly and surfaced later as a wedged
  `get_next_task` and `report`, which walk dependencies expecting a DAG. And
  nesting was never checked at all, though every other insertion path enforces it
  — `insertChild`, `core/move.ts`, with `core/structural.ts` reporting existing
  violations. `--replace` installs the bundle's tree wholesale, so a feature at
  the root or a subtask under an epic was saved without complaint and reappeared
  as a `rex health` / `reorganize` placement violation.
  
  Both are now checked in `parseBundle`, before the store is opened: the rejection
  leaves the tree untouched by construction and does not consume a snapshot slot.
  The errors name the cycle, or both levels and the offending item's title.
  
  Merge mode gets one further check that `parseBundle` cannot make. Its graft
  lands bundle items under *local* parents, and a local reshape may have
  re-levelled a same-id item since the export, so placement is validated against
  the level of the parent the item actually arrives under — sharing one rule with
  the bundle-internal check rather than restating it.
  
  Only cycles are rejected from the dependency graph, not unresolved `blockedBy`
  references: a merge legitimately points at ids that live in the destination
  tree, and a scoped export already prunes the edges it cannot close. The cycle
  detection is now shared with `validateDAG` (`findDependencyCycles`) instead of
  duplicated, and `validateDAG`'s own output is unchanged.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Label a PRD bundle with the document's schema version, not the exporter's.
  
  `buildBundle` wrote `schema: SCHEMA_VERSION` — its own running constant.
  `isCompatibleSchema` deliberately admits newer minors and the document schema is
  a `.passthrough()`, so a document written by a future rex loads here intact,
  unrecognised fields and all. Exporting it relabelled it downward, and
  `parseBundle`'s gate then compared `0 > 0` and never fired: those fields reached
  the tree unvalidated, which is precisely what the gate exists to prevent.
  
  The bundle now carries `doc.schema`, falling back to the running version when
  the document has no marker — a bundle labelled `undefined` is one no version
  gate can read.
  
  Exposure was narrower than it looks, and remains so: the folder-tree load path
  hardcodes the running version and the tree persists no marker of its own, so
  only the legacy `prd.md` / `prd.json` backends preserve a file's schema string
  today. Closing that gap is tracked separately.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop PRD bundles carrying the source project's remote-sync pointers.
  
  `lastSyncedAt` and `remoteId` bind an item to the *source* project's remote.
  `sync.ts` already treats both as non-content, but nothing stripped them on the
  way into a bundle, so they travelled to the destination.
  
  Export from project A, synced to A's Notion workspace, then import into project
  B: the items arrived with A's `lastSyncedAt` at or after their `lastModified`,
  so `isModifiedSinceSync` read them as unmodified and B's first bidirectional
  sync let the remote win, overwriting the freshly imported content in silence.
  The stale `remoteId` values pointed at A's pages, so B's sync wrote into another
  project's remote records.
  
  `buildBundle` now strips both fields recursively from the cloned items.
  Attribution is unaffected — `lastModified` and `lastModifiedBy` are content and
  still travel — and provenance belongs in `exportedFrom`, not in per-item remote
  pointers. The strip runs on the bundle's own deep clone, so the source document
  is left untouched.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex import-bundle` recommending `--replace` over deltas that are not content.
  
  A "differing" collision is what makes the command close with "Use `--replace` to
  overwrite the tree with the bundle instead", so it has to mean the item's
  content differs. It did not. `sameContent` compared every field except
  `children`, including the per-item bookkeeping — and that bookkeeping diverges
  as a matter of course: the import stamps the local copy with the importing actor
  and the time it landed, while a local `rex sync` writes `lastSyncedAt` and
  `remoteId` that the bundle no longer carries at all, since export now strips
  them. Re-importing a round-tripped bundle therefore reported its overlap as
  content collisions and pointed the operator at the one command that can discard
  the whole tree, over items nobody had changed.
  
  Collision kind now ignores `lastModified`, `lastModifiedBy`, `lastSyncedAt` and
  `remoteId`. A genuine edit is still reported as differing.
  
  The field list is now declared once, in `sync.ts`, and shared. It had been
  written out three times — twice in `sync.ts` itself, as two byte-identical sets,
  and once implicitly by the bundle comparison that omitted it. `itemSignature` is
  deliberately *not* reused wholesale: it folds `children` in as an id list, which
  would make a parent read as differing merely because the bundle brought it a new
  child, re-introducing the same spurious collision from the other direction.
  
  The round-trip e2e test asserted the collision count but not the kind, so it
  passed whether every collision was identical or differing. It now asserts the
  kind.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - test(rex): count comparisons instead of timing them in the scoped consolidation complexity gate
  
  `add-auto-reshape.test.ts` asserted that the scoped consolidation pass grows
  sub-quadratically by comparing two wall-clock readings. It failed on an idle
  machine at 8.6x against an 8x bound, and failed reliably under the CPU load of an
  `ndx work` run — which took the hench pre-commit test gate red on every task,
  for reasons unrelated to the code under test.
  
  Tuning the bound could not fix it. The readings were dominated by loading the
  tree (26 vs 101 items) rather than by the cohort scan the test claimed to guard,
  so the signal was a minority of what was measured and the noise floor sat at the
  threshold. The test had already been hardened three times (absolute budget →
  growth ratio, shared store → one store per size, single shot → min of 7).
  
  It now counts calls to `similarity`, the pairwise content-comparison primitive
  that defines the complexity: grouping by normalized title calls it once per
  colliding pair, while comparing every sibling against every other calls it O(n²)
  times. Counts are exact integers, so the result is identical on an idle machine
  and a saturated one. Verified in the failing direction — a nested pairwise scan
  added to `detectNonDuplicateTitleCollisions` took the 24-sibling count from 12 to
  288 and the growth from 4x to 16x.
  
  The test no longer builds a store or touches disk: ~35s of setup and a raised
  60s timeout are gone, and the file runs in under 3s.
  
  No production behaviour changes.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop a bundle's unvalidated `exportedAt` becoming an item's `lastModified`.
  
  `parseBundle` checks only that `exportedAt` is a string, and the import path
  then wrote it straight onto any item that arrived with an author but no
  timestamp. So a bundle declaring `"exportedAt": "yesterday"` put that literal on
  disk. `isModifiedSinceSync` compares timestamps as strings, and `"yesterday"`
  sorts above every ISO stamp, so such an item read as dirty on every sync forever
  and won last-write-wins against every genuine remote edit. A future-dated ISO
  value did the same without looking malformed.
  
  The default is removed rather than validated. It had become redundant: the store
  transaction already fills a missing timestamp and preserves the original author,
  so the item still lands sync-visible and correctly attributed. It also ran
  first, so the unvalidated value won over the checked one.
  
  The argument for keeping it — that `exportedAt` says the content is *at least*
  that old, which is more honest than "when it landed here" — is real but does not
  survive who it applies to. rex writes both stamp halves together, so the only
  items reaching that path come from hand-authored or third-party bundles: the
  same untrusted source as the `exportedAt` being trusted to describe them.
  
  Filling a missing timestamp is now the store transaction's job and only its job.
  `exportedAt` remains bundle provenance, reported and logged, and no longer
  reaches any stored field.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex export` from writing an artifact that becomes the PRD backend.
  
  The in-tree guard rejected only paths inside `.rex/prd_tree/`, which is one
  directory short of the backends the store still falls back to:
  `FileStore.loadDocument` prefers `.rex/prd.md`, then `.rex/prd.json`, whenever
  the folder tree is absent.
  
  Two reachable outcomes, both of which the guard's own docblock claimed to
  prevent. `rex export --out=.rex/prd.json` passed: a bundle envelope carries
  `schema`, `title` and `items`, so it satisfies document validation and silently
  *becomes* the PRD on a checkout without the tree. And
  `rex export --format=narrative --out=.rex/prd.md` planted prose at the preferred
  legacy path, where the markdown parser then throws and blocks every rex command
  on that checkout.
  
  The guard now refuses anywhere inside `.rex/`, which is correct rather than
  merely wider: nothing is ever legitimately exported into the PRD storage
  directory. The bundle and narrative carve-outs in the project guidance are
  reworded to match what the code actually enforces.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Run shell commands in a shell that exists on Windows.
  
  `execShellCmd` hardcoded `sh -c` on every platform. On Windows `sh` ships with
  Git for Windows and is on PATH only inside Git Bash, so from PowerShell or
  cmd.exe — the default shells — the spawn failed with ENOENT. `exec` reported
  that as `exitCode: 1` with empty output, which is indistinguishable from a
  command that ran and failed: hench's test gate concluded the suite was broken
  after essentially every task, and `rex verify` reported `passed: false` for
  tests that never started.
  
  `execShellCmd` now resolves the shell per platform — `sh -c` wherever a POSIX
  shell is resolvable, `cmd.exe /d /s /c` on a Windows box without one. POSIX
  behaviour is unchanged, and Windows machines that have Git for Windows keep
  POSIX semantics rather than being switched to cmd.exe.
  
  `ExecResult` gains `launched`, which is `false` when the command never started.
  Callers that infer pass/fail from `exitCode` alone can no longer mistake an
  unlaunchable command for a failing one; `rex verify` and hench's `run_command`
  now report the two cases differently.
  
  The two remaining sites that spawned `sh` directly (hench's `execShell`, rex's
  `verify`) are routed through `execShellCmd`, and an architecture-policy guard
  fails the build if a new one appears.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Record a bundle import in the execution log.
  
  `.rex/execution-log.jsonl` is the append-only record of PRD activity, and every
  other write path writes to it — add, update, move, remove, prune, reshape,
  reorganize, fix, smart-add, sync. `import-bundle` wrote nothing, so after an
  import nobody could say where the items came from, who ran it, or whether it was
  a merge or a replace: the dashboard's activity view showed a PRD that had
  changed size with no cause. It mattered most on `--replace`, the one command that
  can discard the whole tree.
  
  A successful import now appends a `bundle_imported` entry carrying the mode, the
  added / replaced / collision counts, the bundle's `exportedAt`, and its
  `exportedFrom` branch and commit when present. `appendLog` stamps the actor, so
  the entry answers who as well as what.
  
  The entry is written after the tree write, so a rejected bundle or a declined
  `--replace` leaves the log as silent as it leaves the tree. It is an audit
  record, not a third recovery mechanism: the snapshot and the archive batch exist
  to get items back, while the log preserves what the resulting tree cannot show.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the `rex import-bundle --replace` prompt understating what it will destroy.
  
  The confirmation quoted `existing.items.length` — the number of *top-level*
  items. A PRD of 3 epics holding 240 features, tasks and subtasks asked
  
      Replace the existing PRD (3 items) with the bundle? [y/N]
  
  and then reported `Replaced 240 items`. The one message whose only job is to
  convey the scale of an irreversible wipe understated it by roughly eightyfold.
  
  The prompt now quotes `countItems`, which is what `mergeBundle` already uses for
  the `replaced` count it reports afterwards, so the number the operator agrees to
  and the number they are charged cannot disagree.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Make `rex import-bundle` undoable.
  
  `snapshot-guard.ts` states the guarantee it exists to keep: every command that
  rewrites `.rex/prd_tree/` snapshots it first, so `rex restore` can always return
  the tree to the state it was in before the command ran. Eight commands honoured
  it. `import-bundle` did not — and `--replace --yes`, the non-interactive form in
  its own help examples, discards every local item. It left no snapshot and no
  archive batch, so recovery depended entirely on git, which is no recovery at all
  on a project that gitignores `.rex/prd_tree/`.
  
  The import now calls `ensureSnapshot`, inheriting the `--no-snapshot` opt-out
  and the fail-closed behaviour on a snapshot error rather than reimplementing
  them. The snapshot is taken after any `--replace` confirmation is answered, so a
  declined replace does not burn a slot in the retention cap.
  
  `--replace` additionally records the items it discarded to `.rex/archive.json`
  under a new `import` source, as `prune` and `reshape` do. Both records are
  needed: restoring the snapshot discards whatever the import brought in, while
  the archive keeps individual items — but not their placement — after the
  snapshot has aged out of the retention cap.
  
  `rex import-bundle --help` documents both the snapshot and `--no-snapshot`.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the PRD lock being taken from a process that is still running.
  
  A lock file was treated as stale when its owner was dead **or** when it was
  simply older than 30 seconds. The second half is not a safety net — a hung
  process and a slow one look identical from the outside, and unlinking a running
  writer's lock does not fence that writer off. It admits a second writer into the
  critical section beside it, which is a lost update.
  
  This was observed rather than theorised. Two concurrent `rex import-bundle`
  processes on a loaded machine both entered the critical section, and the
  second's save was rejected by the stale-save guard for deleting an item the
  first had written moments earlier. It surfaced as an intermittent
  `import-bundle-transaction` failure that passed on every re-run — a healthy
  import holds the lock well past 30 seconds when the whole test suite is
  competing for the disk.
  
  Liveness now decides on its own: another process's lock is reclaimed only when
  that process is gone. The `staleMs` option is removed rather than left in place
  doing nothing, since a knob that silently governs nothing is worse than no knob.
  
  The trade is deliberate. A lock whose owner died and whose PID has since been
  recycled by an unrelated live process will not be reclaimed automatically, and
  writers fail after the existing acquire timeout with an error naming the holding
  PID and the path to delete. That is loud, bounded and recoverable; a silently
  interleaved write is none of those.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a narrative PRD rendering: `ndx prd export --format=narrative`.
  
  The PRD can now be written out as prose Markdown for a stakeholder rather than
  as a transport bundle. Epics become sections with a stated goal and a
  rationale, features become described capabilities, and acceptance criteria
  become readable sentences under a "How we'll know it's done" heading.
  Dependencies read as sequencing prose — "This follows on from …" — instead of
  `blockedBy` id lists. The default format is unchanged: `rex export --out=…`
  still writes the JSON bundle.
  
  No internal vocabulary reaches the page. Item ids, folder slugs, and the raw
  status and priority values are all omitted by construction: every status and
  priority is mapped to a phrase chosen to be disjoint from the enum literal it
  replaces (`in_progress` reads as "Under way now", `high` as "Should-have"), so
  a single regex sweep for the literals is a real proof rather than a spot check.
  A uuid pasted into a description is resolved to the title it names — or
  dropped, along with the parentheses it leaves empty, when the title is already
  in the sentence or resolves to nothing.
  
  `--item=<id-or-slug>` narrows the document to one subtree, so a single
  initiative can be handed over without the rest of the PRD. It resolves an item
  id, an exact title, a folder path, or a directory name copied out of
  `.rex/prd_tree/` — including the `-{id6}` suffix, which is often the only part
  of a directory name that still matches after a slug-rule change. An ambiguous
  reference lists the candidates instead of guessing, and a valueless `--item` is
  an error rather than a silent whole-PRD render.
  
  Finished and deleted work is excluded by default. `--include-completed`
  restores finished items for a retrospective-style document; deleted items stay
  out regardless. A finished container that still holds unfinished children is
  kept as a section — heading and goal only, with no state or criteria — so its
  children do not lose the context they sit in.
  
  Narrative output is deliberately one-way and is documented as such in the
  command help, the READMEs, and the PRD-invariant carve-out. The JSON bundle
  remains the only round-trip surface; nothing parses a narrative document back.

- [#361](https://github.com/en-dash-consulting/n-dx/pull/361) [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Extract the CLI's `resolveDir()` (last positional argument, or `process.cwd()`) into its own module (`src/cli/resolve-dir.ts`) so the cwd-relative contract behind `rex mcp .` — and every other `rex <command> .` — can be unit-tested directly, without executing the CLI's top-level `main()`. No behavior change.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a portable PRD bundle: `ndx prd export` / `ndx prd import`.
  
  A PRD can now be carried between machines as a single JSON file, without
  sharing the repo or configuring a remote adapter. `rex export --out=<path>`
  serializes the whole loaded document; `rex import-bundle --in=<path>` rebuilds
  `.rex/prd_tree/` from it. The orchestrator exposes both as an `ndx prd`
  subcommand group; `ndx export`, the static-dashboard exporter, is unchanged.
  
  Fidelity is the point — a round trip preserves item ids, hierarchy, level,
  status, priority, description, acceptance criteria, tags, `blockedBy` edges,
  source, and attribution metadata. Verified against a 1392-item PRD with no
  field, parent, or membership differences.
  
  The bundle carries the PRD `SCHEMA_VERSION`. Import gates on it more strictly
  than the store's read path does: a bundle from a newer rex (newer envelope
  version, newer schema minor, or a different major) is refused before anything
  is written, rather than imported partially. `isCompatibleSchema` keeps its
  forward-compatible behaviour for ordinary loads.
  
  Import has a defined collision policy instead of last-writer-wins. `--merge`
  (the default) is additive: local items keep their content and placement, new
  bundle items are grafted onto the matching parent, an id that already exists
  anywhere in the tree is reported rather than duplicated, and ids whose content
  differs are listed with the local copy kept. `--replace` discards the local
  tree and needs confirmation, or `--yes` when not on a terminal. The tree write
  runs inside `store.withTransaction`, so it holds the PRD lock across the whole
  read-modify-write and cannot lose a concurrent writer's items.
  
  The bundle is a transport artifact, not a PRD backend: writing one inside
  `.rex/prd_tree/` is refused in code, and the PRD invariant — the folder tree is
  the sole writable PRD surface — is documented with an explicit carve-out.
  
  The rex-side importer is named `import-bundle` because `rex import` is a
  long-standing alias for `rex analyze`.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Build rex's and sourcevision's LLM prompts through `PromptEnvelope` so their cost
  is attributable per section rather than as one opaque total.
  
  Every prompt in `rex/src/analyze/` and `sourcevision/src/analyzers/` is now
  declared as a list of named sections against a shared per-package vocabulary,
  with the paired `*Prompt` function reduced to an assembly call. Prompt text is
  unchanged apart from removed doubled blank lines, where an absent conditional
  block used to leave its own padding behind — pinned by `prompt-text-identity`
  snapshot suites in both packages.
  
  The section-measurement helpers (`promptSectionCosts`, `dominantPromptSections`,
  `formatPromptSectionCosts`, `extractPromptSectionDiagnostics`) moved down to
  `@n-dx/llm-client` so rex and sourcevision, which sit below hench and cannot
  import from it, share one implementation instead of a copy; hench keeps only its
  CLI rendering and reaches the rest through its existing gateway.
  
  The prompt census now follows module-local helper calls when extracting static
  prompt text. Factoring duplicated text into a helper previously dropped it from
  the count entirely, so a refactor could silently shrink the baseline. Correcting
  this raised the recorded totals ~5% with no prompt growing — the earlier figures
  were an undercount — and the baseline records the revision so the jump is not
  misread as a regression. The baseline also now reports a per-section breakdown
  for each envelope-built package.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex import-bundle --replace` clearing the destination's own remote pointers.
  
  `remoteId` and `lastSyncedAt` say which record in *this* project's remote an item
  maps to, and when it was last reconciled. A bundle cannot know either — export
  strips them so one project's pointers never reach another — so their absence
  from a bundle is silence, not an instruction to clear.
  
  `--replace` read it as an instruction, and installed items with neither over
  local items that had both. Two consequences on the same-project
  export → edit → replace round trip the feature documents. Every item lost
  `lastSyncedAt`, so `isModifiedSinceSync` went true tree-wide and the next
  `rex sync` would push the whole tree and win every field conflict against remote
  edits made since. And `remove-feature.ts` collects its "this item is synced,
  warn before deleting" list by `remoteId`, so `rex remove` silently stopped
  offering to clean up the remote records. Inert without a remote adapter
  configured, since the fields are never set there.
  
  A replace now carries the destination's pointers onto the ids that survive it.
  An id the destination has never seen gets none, which also clears anything a
  hand-authored bundle tried to smuggle in — `parseBundle` already stripped those,
  and `mergeBundle` now holds the same guarantee on its own terms rather than by
  its caller's good behaviour.
  
  The export-side guarantee is unchanged: a bundle still carries no remote
  pointers at all.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Remove instructions that rex prompts already gave elsewhere in the same prompt,
  and resolve a task-size contradiction between them.
  
  `TASK_QUALITY_RULES` sized a task at "one focused session (1-4 hours)" while
  `PRD_SCHEMA` asked for `loe` in engineer-weeks, `CONSOLIDATION_INSTRUCTION` asked
  for 0.5–4 engineer-week tasks, and decomposition splits anything over
  `taskThresholdWeeks: 2`. Nine builders carried the hours figure; eight of those
  also carried a weeks figure. `buildAssessmentEnvelope` — the prompt that decides
  whether to split or merge a proposal — graded week-scale work against the same
  hour-scale bar, so it recommended `break_down` on correctly-sized tasks. Sizing
  is now stated in engineer-weeks everywhere.
  
  Deleted as duplicated within the prompt that contained them: the markdown-fence
  prohibition (already in `OUTPUT_INSTRUCTION`), the "tasks need a description and
  criteria" and "no vague titles" rules (already in `TASK_QUALITY_RULES`, and
  restated twice more in `consolidation-guard` and `decompose`), the existing-PRD
  duplicate rule (kept in `ANTI_PATTERNS`, which reaches every prompt that had
  both), and `AUTO_PLACEMENT_INSTRUCTION`'s restatement of what `existingId` does.
  No instruction was removed from a prompt that did not still state it.
  
  Measured with `scripts/prompt-census.mjs`: rex drops from 16,121 to 15,217
  per-call tokens and 7,473 to 7,195 unique, a monorepo total of -904 / -278. A new
  `prompt-non-redundancy.test.ts` suite pins each rule against reintroduction, and
  both prompt suites now share one fixture list so a new prompt cannot be covered
  by one and missed by the other.
  
  Also adds `.hench/session-cache.json` to the `ndx init` ignore template, matching
  this repo's own `.gitignore`.

- [#366](https://github.com/en-dash-consulting/n-dx/pull/366) [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Spawn the vendor CLI (Claude CLI provider) with `cwd` set to the project directory being analyzed, instead of inheriting the calling process's own cwd.
  
  `rex analyze <dir>` and `sv analyze <dir>` (and the other LLM-assisted commands that share the same module-level client — `reorganize`, `prune`, `reshape`, `smart-add`, and the reorganize MCP tool) now call `setProjectDir(dir)` alongside `setClaudeConfig`/`setLLMConfig`, so the vendor CLI resolves its own project context (CLAUDE.md, `.mcp.json`) against the directory being analyzed rather than wherever the command was invoked from. Matches the fix already applied to the dashboard's Ask route.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Scope a PRD bundle to one item: `rex export --item=<id-or-slug> --out=<path.json>`
  (also `ndx prd export --item=…`).
  
  A single epic or feature can now be carried between machines without exporting
  the whole PRD. The scope is a closure rather than a filter, because a filtered
  subtree is not importable:
  
  - the requested item arrives with **every descendant** beneath it, so the
    fragment is a working subtree rather than a childless stub;
  - it arrives with the **transitive `blockedBy` closure**, so a task blocked by
    an item in a different epic brings that item along. Keeping the edge without
    the target would import a dangling dependency; dropping the edge would lose
    sequencing information;
  - it arrives with the **ancestor containers** of everything selected, so import
    reconstructs the subtree at its original depth instead of re-parenting it to
    the root. That applies to items the closure itself pulled in, so a blocker
    from another epic brings its own chain of containers.
  
  Blockers are carried without their own descendants — a blocker is needed as a
  dependency target, not as a body of work, and expanding it downward would make
  a scoped export unbounded in practice.
  
  The export summary counts the requested subtree and the closure's contribution
  separately ("2 requested items … closure pulled in 1 blocking item and 3
  ancestor containers"), because a closure can reach well past what was asked
  for and a scoped export that quietly grows to half the PRD should say so.
  `--format=json` reports the same breakdown under a `scope` key.
  
  Every `blockedBy` id in a scoped bundle resolves to an item in the same bundle.
  An edge whose target is missing from the source PRD — already broken before the
  export — is dropped rather than carried, and reported with the item that held
  it.
  
  `--item` resolves through the same resolver the narrative rendering uses, so a
  uuid and a folder slug name the same item and one flag keeps one meaning. An
  unknown or ambiguous reference fails before anything is written, so a mistyped
  slug never leaves a whole-PRD bundle named after the item it meant to scope to.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop an attribution-only item being permanently invisible to remote sync.
  
  `stampChangedItems` treated `lastModifiedBy` as a complete stamp and skipped the
  item, which protected the original author — a bundle import carries attribution
  for items whose source project never recorded a timestamp, and overwriting it
  would destroy exactly the provenance a transport artifact exists to preserve.
  But it bought that at the cost of the other half: `isModifiedSinceSync` opens
  with `if (!meta.lastModified) return false`, so such an item was never
  considered modified, and it could not acquire a timestamp later either, because
  from the next transaction on the snapshot records it as pre-existing and
  unchanged. The item was never pushed, and the next pull overwrote its content
  with the remote's value in silence.
  
  The two halves are now filled independently: a new item always leaves with a
  `lastModified`, and its `lastModifiedBy` is set only when it brought none. An
  item that arrives with a timestamp but no author is left alone — it is already
  visible to sync, and the actor running the transaction did not write it, so
  recording them would be a fabricated attribution rather than a default.
  
  This closes the general case behind a defect previously fixed only for bundle
  import. `stampChangedItems` runs inside every `withTransaction` on both store
  adapters, so any other path inserting an attribution-only item — an MCP
  `add_item`, a hand-edited `index.md` picked up by a later transaction — hit the
  same silent loss. Bundle import still defaults the timestamp to the bundle's
  `exportedAt`, which is a more honest value than "now" and is left untouched
  here.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop a null `lastModified` slipping past the stamp repair.
  
  `stampChangedItems` decided an item already had a timestamp with
  `!== undefined`, while its only consumer opens with
  `if (!meta.lastModified) return false`. So `null` and `""` were "no timestamp"
  to the reader and "has one" to the guard, and the repair skipped exactly the
  items it exists for.
  
  The consequence was permanent. The frontmatter emitter drops the null, so from
  the next load the item reads as pre-existing and unchanged, can never acquire a
  stamp, is never pushed to a remote, and is overwritten by the remote's value on
  the next pull — the silent sync invisibility this repair was written to prevent,
  reached through a different door. `rex export` never emits a null, so it takes a
  hand-authored or third-party bundle; the document schema is a passthrough and
  never declares the field, so such a bundle validates cleanly on the way in.
  
  Both halves of the stamp now use truthiness, matching the consumer. The author
  half had the same split, with a milder cost — a dropped author loses provenance
  rather than sync visibility.

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

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Record the folder tree's schema version, so a document reports what wrote it.
  
  The tree load path hardcoded the running `SCHEMA_VERSION`, and `tree-meta.json`
  held only the title. A document therefore reported whichever rex read it rather
  than whichever wrote it, which defeats forward compatibility at one remove: the
  document schema is a `.passthrough()` and `isCompatibleSchema` admits newer
  minors, so a tree written by a future `rex/v1.1` loads here intact — unrecognised
  fields included — while claiming to be `rex/v1`. Exporting it produced a bundle
  labelled `rex/v1`, and `parseBundle`'s minor gate then compared equal minors and
  admitted those fields into another tree unvalidated. That is the hole
  `buildBundle`'s `doc.schema` stamp was meant to close, reached by a different
  route; this is what makes `doc.schema` worth stamping.
  
  `tree-meta.json` now carries `schema` alongside `title`, and both store adapters
  read it back. A tree written before the marker existed keeps loading — an absent
  or non-string marker falls back to the running version rather than being treated
  as corrupt.
  
  A marker that *is* a string is returned verbatim, including one this rex cannot
  read. The compatibility checks downstream are what should refuse `rex/v2`, and
  they can only do that if the value reaches them.
  
  The four writers of this file use three different mechanisms, for durability
  reasons that still hold, so only the *shape* is consolidated — in a new
  `store/tree-meta.ts` — which is enough to stop the schema field quietly going
  missing from one of them.
- Updated dependencies [[`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9)]:
  - @n-dx/llm-client@0.6.0

## 0.5.2

### Patch Changes

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex add` hanging forever when stdin is an open pipe.
  
  `dispatchAdd` awaited `readStdin()` before deciding which mode it was in, so
  every invocation paid for the piped-description form. `readStdin` guards on
  `isTTY`, and a `/dev/null` redirect reaches EOF at once — so the bug was
  invisible interactively and in most scripts, and bit the caller that matters
  most: anything spawning the CLI with `stdio: "pipe"` and no intention of
  writing. The pipe never closes, `end` never fires, and the command waits
  forever with no output. Manual mode is identified entirely by argv, so it now
  runs without touching stdin: 147ms instead of unbounded.
  
  Two related faults surfaced while testing:
  
  - An unrecognised `--level` fell through to smart mode, which then waited on
    stdin for a description that was never coming — a typo presented as a hang.
    It is now an error naming the valid levels.
  - The remaining legitimate waits were silent. They now announce themselves on
    stderr after two seconds. The read itself is deliberately *not* bounded: a
    first attempt cut it off after a deadline and silently discarded a payload
    whose first byte arrived at three seconds. Losing piped input is worse than
    waiting for it, so the fix bounds the silence rather than the read.
  
  The piped smart-add form (`echo "desc" | rex add`) is unchanged.

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

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Replace identical-prompt retries with an escalation ladder.
  
  The retry path resent a byte-identical prompt up to three times and told the
  model nothing about why the previous answer was rejected. A model that emits
  unparseable JSON once will usually do it again given the same input, so those
  were three calls billed for one answer.
  
  Retries now carry the validation error verbatim, and run on the standard tier.
  That is two independent wins for different classes: the error feedback helps
  every class — it is the actual complaint behind the audit finding — while model
  escalation only changes anything for light-routed classes, where it is what
  makes cheap-first routing safe. A light model that cannot satisfy the contract
  hands off instead of failing the command. The attempt number is included in the
  feedback, so consecutive prompts differ even when the error repeats, which is
  the property the old loop violated.
  
  The retry count is unchanged at three attempts: this changes how retries
  behave, not how many there are. Only validation failures escalate — transport
  and auth errors propagate immediately, since escalating them neither diagnoses
  nor fixes anything. Sourcevision's prompt-degradation ladder is untouched: it
  shortens the prompt on the same model, which is right for a context-overflow
  failure, while this escalates the model on the same prompt, which is right for
  a capability failure. The failure class decides which applies.
  
  Applied to `prd.modify` (the audit's named site), `prd.rename`, and
  `prd.merge`. Along the way, rename's title-collision check moved *inside* the
  output contract: it used to run after every retry, so a light model returning
  two identical titles failed the rename outright — now the standard tier gets a
  chance at it.
  
  Escalation rates are tracked per task class, so a class escalating on more than
  a fifth of its calls — the signal that its light routing is not paying for
  itself — is visible rather than inferred.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Hold the folder-tree lock across `syncFolderTree`, and give both stores one
  lock name for the tree.
  
  `syncFolderTree` — run after every PRD mutation, from the CLI and from every
  MCP write handler — did an unlocked `loadDocument()` followed by an unlocked
  full re-serialize of `.rex/prd_tree/`. Serialization deletes every on-disk
  entry absent from the snapshot, so the sync was a read-modify-write racing
  whatever writer came next, with two failure modes:
  
  - **Crash.** The read could observe a half-created item directory (an item
    gaining its first child converts a bare `<slug>.md` into a `<slug>/`
    directory), `parseFolderTree` threw ENOENT, and the handler returned
    `isError`. This is the flake behind
    `concurrent-write-lost-update.test.ts > an item inserted while
    update_task_status deletes another survives`, which failed only under CI
    load because the overlap window is timing-dependent.
  - **Silent lost update.** The sync passed no `loadedAt`, which disables the
    serializer's stale-save guard, so it would delete a concurrent writer's
    items with no error — the exact hole the surrounding suite exists to pin.
  
  The sync now runs its load and its serialize inside one lock acquisition. That
  closes both: it sees the committed tree rather than a transient one, and its
  snapshot cannot go stale while it holds the lock (so no `loadedAt` proof is
  needed).
  
  Separately, `FileStore` guarded the tree with `tree.lock` while
  `FolderTreeStore` used `prd.lock`. Two names for one resource meant a writer
  on each store could rewrite `.rex/prd_tree/` simultaneously with neither
  seeing the other. Both now derive the path from `prdLockPath()` in
  `store/paths.ts`, alongside `PRD_TREE_DIRNAME`.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Complete light-tier routing: move classification to the light tier, and give
  the two unguarded light calls real output contracts.
  
  `sourcevision`'s classification batches now resolve through the `code.classify`
  task class. This is the last of the audit's routing-map flips and the safest of
  them: a fixed-size batch goes in, an enum-constrained list comes out, unknown
  paths and unknown archetype ids are already dropped per item, and a prompt
  degradation ladder already handles parse failures — so a wrong answer costs one
  dropped classification.
  
  Routing a call to the cheapest adequate model is only a safe trade while bad
  output stays detectable, and two light-routed calls had nothing checking them.
  
  The commit-subject call feeds `git commit -m` directly, and previously took the
  first non-empty line and sliced it to 100 characters — so a fenced block, a
  "Sure! Here's a subject:" preamble, or a markdown bullet would have been
  committed into the repository's history. It now goes through a contract that
  strips those tics and enforces one line within the documented 72-character
  bound, falling back to the generic message when nothing usable survives:
  refusing to commit would be worse than committing under a generic subject.
  
  The body-merge call was worse — whatever the model returned was written verbatim
  as the surviving PRD item's description, so an empty answer or a JSON blob would
  have been persisted as the item's body. It now validates, and *throws* on
  failure rather than repairing: `reshape` already treats body merge as
  best-effort and keeps the existing description, which beats persisting a
  preamble or a sentence cut in half by a length cap.
  
  The other six light-routed sites were audited and already had contracts — zod
  schemas for renames, clarify rounds and the assessment pass, and proposal
  parsing with count checks for the consolidation guard. A new integration test
  pins the resolved model for every class in the routing map, in both directions:
  the light routes must be light, and the agent loop, proposal generation, and
  deep enrichment must not be.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Compact the JSON that rex prompts send and ask for.
  
  Six prompt builders embedded their payload with `JSON.stringify(x, null, 2)` —
  guard, breakdown, consolidate, assess, modify, decompose. Indentation is billed
  as input on every analyze call and buys nothing: the model reads the shape from
  the keys, not the whitespace. On a five-proposal payload the embedded JSON drops
  37% (9,297 → 5,896 characters).
  
  The two few-shot examples were hand-written pretty JSON, so they carried the
  same cost and, once the prompts started asking for minified output, contradicted
  their own instruction. Both are now minified.
  
  Output is where the real saving is — output tokens cost roughly 5x input on
  every tier — so the shared `OUTPUT_INSTRUCTION` and the bespoke instructions in
  the assessment, decompose, and reshape prompts now ask for minified JSON
  explicitly ("no whitespace between tokens, no indentation, no line breaks") and
  tell the model not to restate the input.
  
  Response parsers are unchanged and still pass: they already tolerated fences and
  surrounding prose, and compact JSON parses identically.
  
  The new `prompt-json-discipline.test.ts` builds each prompt and asserts the
  result carries no indented JSON and does ask for minified output. It checks
  behaviour rather than grepping for `null, 2`, because grep cannot tell a prompt
  from the many legitimate pretty-printers in the tree — `--format=json` CLI
  output and on-disk config files are supposed to stay readable, and were left
  alone.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Report PRD tree paths written in a foreign slug convention, and pin write-path
  parity.
  
  A rex build older than the id-qualified slug rule (landed 2026-08-26)
  re-serializes the whole tree to the suffix-less form on its first write —
  observed 2026-09-01 as 823 of 1398 files renamed by a single status update.
  Nothing caught it: every rename was lossless, item content was untouched, and
  `rex validate` inspects item fields without ever looking at the paths those
  items live in. So an 800-file rewrite read as a clean tree.
  
  `findNonConformingSlugs` compares each item's on-disk entry against what
  `slugify` would produce, and `rex validate` reports mismatches as warnings
  naming `rex migrate-slugs` as the repair. An item whose file is merely missing
  is not reported — that is a separate fault, and folding it in would make this
  finding noisy enough to ignore.
  
  Also adds `write-path-parity.test.ts`, which disproves the assumption that
  prompted this work: the MCP handler and the CLI's update sequence produce
  byte-identical trees, and a status update rewrites at most three files at
  steady state. The suspected divergence was not in either code path.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Thread task classes through every package's LLM choke point, and pass the
  routing config surfaces through the `.n-dx.json` loader.
  
  rex's `spawnClaude`/`resolveConfiguredModel` accept `{ taskClass }` alongside
  the legacy bare weight (the class wins; an explicit model still beats both),
  and the analyze call sites now declare their classes — renames, merges,
  consolidation checks, assessment, and clarify rounds route light by registry
  default exactly as before, while proposals, modify, spec synthesis, smart-add,
  and restructuring declare their standard-tier classes. `prd.decompose` is
  deliberately not declared yet: its registry default is light, and that flip is
  gated on the escalation ladder. sourcevision's `callClaude` gains the same
  option, `resolveLightModel` now resolves through `zone.enrich-scan`, and the
  enrichment passes and meta-evaluation declare their classes. hench resolves
  the agent loop via `agent.execute` (standard by default — but
  `llm.routes["agent.execute"] = "heavy"` now reroutes a run with no code
  change), the pre-run commit message via `git.commit-message`, and CLI-path
  run records carry the resolved tier in `weight` instead of always "standard".
  `loadLLMConfig` passes `llm.tiers`, `llm.routes`, `llm.effort`, and
  `llm.escalation` through its whitelist so the new config actually reaches
  runtime. A repo-level contract test walks declared task classes and fails on
  any class missing from `DEFAULT_ROUTES` or any choke point that stops
  declaring its classes.
- Updated dependencies [[`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec)]:
  - @n-dx/llm-client@0.5.2

## 0.5.1

### Patch Changes

- [#335](https://github.com/en-dash-consulting/n-dx/pull/335) [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Resolve actor identity (git `user.name`/`user.email` → `os.userInfo()` → `"unknown"`, cached per process) and stamp attribution on writes: `stampModified()` now also sets `lastModifiedBy` on PRD item mutations, and the new `stampActor()` sets `actor` on execution-log entries. Wired into every mutation-capable store: `FileStore` (the production writer), `FolderTreeStore`, and the Asana/Notion/Jira/GitHub Projects adapters. Both fields are passthrough on the existing schemas — additive, non-breaking.

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

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - Every PRD tree slug is now id-qualified, and `rex migrate-slugs` renames existing trees in one pass.
  
  `slugify()` emitted title-only slugs — the `-{id6}` suffix appeared only for long titles or same-tree sibling collisions. Same-titled items created on divergent branches therefore collided on identical paths, so a git merge silently unified two distinct items, and renaming an item relocated its files entirely. The suffix is now unconditional: every new write lands at `<title-slug>-<id6>`, making paths collision-free across branches (the title body is truncated to keep slugs within 40 characters, unchanged).
  
  Existing trees keep working — the parser never depended on slug shape — but their next full save would rename everything as a side effect. `rex migrate-slugs` does that rename as one deliberate, reviewable pass instead: it snapshots the tree (undoable via `rex restore`), round-trips it through the store under the PRD lock, and reports how many entries were renamed. Idempotent — a second run is a no-op. The folder-tree schema doc's naming rules, examples, and collision-resistance notes are updated to match.

- [#341](https://github.com/en-dash-consulting/n-dx/pull/341) [`2bb6a4c`](https://github.com/en-dash-consulting/n-dx/commit/2bb6a4c240e61aa34bf0d240e7ffc26c7e5a4dab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Route mechanical single-shot LLM calls to the light model tier. In rex, `spawnClaude()` gains an optional task-weight parameter (default `"standard"`), and sibling renames, group renames, body merges, the consolidation guard, the granularity assessment pass, guided clarify rounds, and the post-prune consolidation pass now resolve the vendor's light-tier model (e.g. haiku) when no explicit model is given. In hench, pre-run commit-message generation resolves the light tier instead of the run's standard model. An explicit `--model` flag (or a per-vendor `lightModel` config for the light tier) still overrides tier resolution, and the active tier is surfaced in vendor-header/spinner output ("light tier").

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - New `rex merge-driver` command: a three-way, frontmatter-aware git merge driver for `.rex/prd_tree/`.
  
  Git's default text merge produces spurious conflicts on PRD markdown (two branches touching adjacent frontmatter lines) and silent mis-merges of list fields. The driver merges at field granularity with a rule per field class: `tags`/`blockedBy` get a three-way set merge (additions from both sides land, removals stick — never conflicts); `status`/`priority` divergence resolves to the side with the later `lastModified` stamp; `lastModified` takes the later value; every other field and the body merge plain three-way. Only genuinely conflicting fields emit standard `<<<<<<<`/`>>>>>>>` markers — everything mergeable still merges around them — and the driver exits nonzero so git marks the path conflicted, per the merge-driver protocol (result written to the %A path).
  
  Register per repository (a future `ndx init` change will do this automatically):
  
  ```
  git config merge.rex-prd.name   "n-dx PRD tree merge"
  git config merge.rex-prd.driver "rex merge-driver %O %A %B"
  echo '.rex/prd_tree/** merge=rex-prd' >> .gitattributes
  ```

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - Saving a stale PRD snapshot now fails loudly instead of silently deleting another writer's items.
  
  Every save of the PRD folder tree removes on-disk items absent from the document being saved — a full-replacement contract that made a save from a pre-merge or stale snapshot silently destroy items it never loaded, with only the gitignored local `.rex/.backups/` for recovery.
  
  The serializer now collects deletions instead of applying them mid-walk, and guards them before deleting anything: a deletion candidate whose on-disk state is newer than the document's load time (recursively — a fresh child inside an old folder counts) aborts the entire save with an error naming each item that would have been destroyed, its id, and its path. Both stores stamp the load time on every `loadDocument` and refresh it after their own successful saves, so normal load-edit-save flows and same-writer sequential saves are unchanged while a genuinely stale snapshot is refused. A save that never loaded the tree may not delete at all; a deliberate whole-tree rewrite (migration, restore) states its intent with the serializer's explicit `allowBulkDelete` option.

- [#335](https://github.com/en-dash-consulting/n-dx/pull/335) [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Stamp an ISO `lastModified` on every `FolderTreeStore` mutation (`addItem`, `updateItem`, and — on the affected parent — `removeItem`). Previously `FolderTreeStore` ignored this entirely, so `SyncEngine.isModifiedSinceSync()` always returned false for folder-tree-backed items and locally edited items were silently skipped on `push`. `lastModified` is an existing passthrough field (see `packages/rex/src/core/sync.ts`), so this is additive and does not change the PRD schema.

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

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - New `rex validate --post-merge`: structural check for a freshly merged PRD tree, with `--repair` for the safe classes.
  
  A git merge of `.rex/prd_tree/` can leave corruption no rex code path produces, and none of it errored: duplicate IDs (both branches created or moved the same item at different paths), directories whose `index.md` was lost in conflict resolution, files at the wrong nesting depth, `blockedBy` references to items the other branch deleted, and unresolved conflict markers. The scan reads the raw tree — deliberately not the store, whose parser would normalize or choke on exactly this input — and reports every class.
  
  `--repair` fixes the deterministic classes (empty orphaned directories removed, `level` rewritten to the depth-implied value, dangling `blockedBy` ids dropped while valid ones are kept) and refuses the ambiguous ones (duplicate IDs, conflict markers, orphaned directories that still contain items) with instructions. Exit codes are hook-friendly — 0 clean, including a repo with no PRD tree; 1 issues remain — and the folder-tree schema doc shows the optional git post-merge hook wiring.

- [#331](https://github.com/en-dash-consulting/n-dx/pull/331) [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Add `--verbose`/`--debug` live progress across `ndx init` and `sourcevision analyze`, and replace scattered vendor string literals with shared `LLM_VENDOR` constants.
  
  **Live progress instrumentation.** `ndx init` gave no visibility into a slow `sourcevision analyze` run — `--debug` reached the child process but its output was fully captured and discarded on success, so a slow run was indistinguishable from a hung one. `ndx init`'s spinner now forwards the child's own progress live (throttled so a high-volume `--debug` firehose can't stall the pipe via backpressure), and the Components phase (component parsing, route detection, server-route detection) gets per-operation timestamped tracing plus automatic gap detection that flags any silence past 250ms by naming the last known checkpoint. A worker-thread-backed live stopwatch prints an incrementing "current operation runtime" for any operation still in flight — verified to keep ticking even during a fully synchronous, non-yielding block, which a same-thread timer cannot do. `hench`'s shell tool gets equivalent live-tail output for long-running commands.
  
  **Fixed a real infinite loop this instrumentation surfaced.** `inferPrefix` (server-route prefix inference) could spin forever on any two ordinary routes that share no deeper common path (e.g. `/users/:id` and `/orders`) — confirmed live via a CPU sample showing 100% of time in `String.prototype.lastIndexOf`. Also tightens `isLikelyRouteFile` so a client-side `api/` directory (axios/fetch-style callers, not Express-style route definitions) is no longer scanned for server routes at all, and adds a length guard against any future misextracted route "path" that's actually an unrelated string literal.
  
  **Vendor literal consolidation.** Replaces hardcoded `"claude"`/`"codex"`/`"google"`/`"local"` string comparisons throughout `core`, `hench`, `rex`, `sourcevision`, and `web` with the canonical `LLM_VENDOR`/`DEFAULT_LLM_VENDOR`/`LLM_VENDORS`/`isLLMVendor` helpers exported from `provider-interface.ts` and re-exported through each package's llm-client gateway, so the supported-vendor set has one source of truth instead of being duplicated ad hoc at each call site.
  
  **Fixed `ndx config <key>` incorrectly reporting an initialized project as stale.** The pre-dispatch directory resolver used for the staleness check and command-timeout config load treated a config key like `llm` as a target directory when no explicit directory argument was given, so `ndx config llm` looked for `.sourcevision`/`.rex`/`.hench` under a nonexistent `llm/` subdirectory and reported a fully-initialized project as uninitialized.
- Updated dependencies [[`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9)]:
  - @n-dx/llm-client@0.5.1

## 0.5.0

### Patch Changes

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface concise re-authentication guidance when a provider rejects credentials, and stop dumping raw JSON error payloads.
  
  A new canonical helper in `@n-dx/llm-client` (`authFailureGuidance` / `authFailureMessage`) is the single source of truth for auth-failure wording: it names the provider, states the cause (`Invalid or expired credentials`), and gives the exact fix — `claude logout && claude login`, `codex logout && codex login`, or `ndx config llm.google.api_key <KEY>`. Every entry point now reads identically:
  
  - **`ndx init` / `ndx config llm.vendor`** — the core preflight (`packages/core/config.js`) replaces the verbose `Details: <raw JSON>` dump with the concise, ANSI-colored guidance (red headline, yellow remediation). The NDX error code (e.g. `NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED`) is demoted to a dim secondary line instead of the headline, and JSON payloads are never printed. A missing Google key gets a distinct "No API key configured" message.
  - **`ndx work`** — the runtime LLM providers already throw `AuthFailureError`; its message is now the canonical, JSON-free line.
  - **`ndx plan` / `ndx analyze`** — rex/sourcevision route auth errors through the shared classifier and (for rex) render `AuthFailureError` with the shared remediation.

- [#316](https://github.com/en-dash-consulting/n-dx/pull/316) [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(hench): make parent auto-completion self-healing so cascades are no longer silently lost ([#293](https://github.com/en-dash-consulting/n-dx/issues/293))
  
  During `hench run --auto --loop`, a child task could be persisted as `completed` while the parent auto-completion cascade was silently dropped — leaving parent features stuck `pending` with every child done, and no reconciliation path to recover. The cause: in `toolRexUpdateStatus` the `status_updated` log append and the cascade shared the caller's single best-effort `try/catch`, so a log-append failure after the child's status write cancelled the cascade; and the cascade was event-driven (`findAutoCompletions` walks only the triggering item's ancestor chain), so a missed cascade was never retried.
  
  Two changes:
  
  - **rex:** add `reconcileAutoCompletions(items)` — a whole-tree, bottom-up sweep that completes every parent whose children are all terminal (`completed`/`deferred`), independent of any single trigger item. It self-heals parents whose earlier cascade was lost. Exported from `public.ts`.
  - **hench:** in `toolRexUpdateStatus`, wrap the `status_updated` append in its own try/catch so a log failure can no longer cancel the cascade, and drive the cascade with `reconcileAutoCompletions` (via `rex-gateway`) for whole-tree healing. Cascade failures in `updateCompletedTaskStatus` and the finalize path are now recorded in `run.diagnostics.notes` instead of a console-only warning.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the dashboard Reshape preview always reporting "no proposals": the server now spawns `rex reshape --format=json --quiet` so stdout is pure JSON (info() progress prose no longer breaks the report parse), and `rex reshape --format=json` emits a JSON report (`proposals: []`) instead of prose when no proposals are found.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add Asana as a work-tracking integration target. A new built-in `asana` store adapter syncs the PRD tree to tasks in an Asana project: `rex adapter add asana --token=<pat> --projectId=<gid>` configures the connection (token redacted to `REX_ASANA_TOKEN`), and `rex sync --adapter=asana` creates/updates Asana tasks through the existing `SyncEngine`, which reports per-item results. The PRD hierarchy maps onto Asana subtasks; each task's native `external` field carries the PRD item id plus level/status/priority and other PRD-only metadata, so rex-managed tasks round-trip faithfully while tasks authored in the Asana UI degrade gracefully (level inferred by depth, status from the completed flag). Kept separate from the Notion, Jira, and GitHub Projects integrations. Adds an `asana` integration schema for the web UI and folds the duplicated built-in-adapter name list into an exported `BUILT_IN_NAMES` set.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add GitHub Projects as a work-tracking integration target. A new built-in `github` store adapter syncs the PRD tree to a GitHub Projects (v2) board: `rex adapter add github --token=<pat> --projectId=<PVT_...>` configures the connection (token redacted to `REX_GITHUB_TOKEN`), and `rex sync --adapter=github` creates/updates project draft issues through the existing `SyncEngine`, which reports per-item results. GitHub Projects v2 is a flat collection with no `external` field or native hierarchy, so each PRD item is stored as a draft issue whose body carries the human-readable description + acceptance criteria plus a hidden `<!-- n-dx-meta: {json} -->` footer holding the PRD id, parent id, level, status, priority and other PRD-only metadata; the tree is reconstructed from the footer's parent id. Draft issues authored in the GitHub UI degrade gracefully. The adapter talks to the GitHub GraphQL API via `fetch` (no new dependency). Adds a `github` integration schema for the web UI. Kept separate from the Notion, Jira, and Asana integrations.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add Jira as a work-tracking integration target. The existing `jira` integration schema (previously a UI-only stub) is now backed by a built-in `jira` store adapter that syncs the PRD tree to Jira issues: `rex adapter add jira --domain=<host> --email=<email> --apiToken=<token> --projectKey=<KEY>` configures the connection (API token redacted to `REX_JIRA_API_TOKEN`), and `rex sync --adapter=jira` creates/updates issues through the existing `SyncEngine`, which reports per-item results. Each PRD item maps to a Jira issue of the configured type (default "Task"); summary ↔ title, description + acceptance criteria render into the issue description (converted to Atlassian Document Format by the client), and the PRD id, parent id, level, status, priority and other PRD-only metadata are carried in a hidden `<!-- n-dx-meta: {json} -->` footer so the tree round-trips. When label sync is enabled, PRD tags are also written to Jira labels (sanitized). The client talks to the Jira Cloud REST API v3 via `fetch` with Basic auth (no new dependency). Kept separate from the Notion, Asana, and GitHub Projects integrations.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a common PRD-to-work-item linkage model. `PRDItem` now carries an optional structured `links` array (`WorkItemLink`), the system-agnostic surface every work-tracking integration (Notion, Jira, GitHub Projects, Asana, …) uses to record the relationship between a PRD requirement and its downstream work item — link identity is `(system, workItemId)`. A new `core/work-item-link.ts` module exposes pure, immutable operations — `getLinks`, `findLink`, `upsertLink`, `removeLink`, `updateLinkSyncState` — so a linkage is stored when a work item is created (`upsertLink`) and reflects the latest known remote state (`updateLinkSyncState` patches `syncState`/`remoteStatus`/`lastSyncedAt`/`error`). Links round-trip through the folder-tree serializer/parser (object-array frontmatter, like `commits`) with no storage changes, so they are visible whenever the PRD is loaded. Validated by `WorkItemLinkSchema` (strict). The pre-existing single `remoteId` sync field is left untouched for backward compatibility.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#318](https://github.com/en-dash-consulting/n-dx/pull/318) [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(token-usage): report actual token usage broken out by type (input/output/cache-write/cache-read), consistently in rollup and dashboard ([#294](https://github.com/en-dash-consulting/n-dx/issues/294))
  
  The per-item rollup summed cache tokens into a single conflated total (~23M for a run whose real work was ~40K), while the dashboard Usage page counted only input+output — a ~575× divergence for the same runs. Rather than pick one number, both surfaces now report the actual usage broken out by type, with no cost/pricing math.
  
  - **rex:** `ItemTokenTuple` now carries `input`, `output`, `cacheCreation`, `cacheRead`, and `total` (= their sum). `tokensFromRecord`, self/descendant attribution, and the ancestor roll-up track all four components; `get_token_usage` surfaces the breakdown.
  - **web:** the Usage-page extractor reads `cacheCreationInput`/`cacheReadInput` from run records (previously dropped), surfacing cache-write and cache-read as distinct fields and attributing run-level cache totals without double-counting across turns. `incremental-task-usage` uses the same breakdown, so the dashboard and rollup report identical numbers for the same runs.

- [#334](https://github.com/en-dash-consulting/n-dx/pull/334) [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Security and modernization pass over all dependencies. Resolves all 45 `pnpm audit` findings (2 critical, 16 high) via updated direct dependencies and refreshed pnpm overrides (hono, @hono/node-server, fast-uri, ip-address, js-yaml, nanoid, postcss, qs, vite, ws, body-parser). Modernizes major tooling: TypeScript 6.0, vitest 4.1.10, ink 7, ora 9, jsdom 30, esbuild 0.28, @modelcontextprotocol/sdk 1.30, @anthropic-ai/sdk 0.117, changesets 3. Raises the supported Node.js floor from 18 to 22 (Node 18 and 20 are both end-of-life; CI already runs Node 22).

- [#323](https://github.com/en-dash-consulting/n-dx/pull/323) [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the PRD rollback snapshot on Windows, and add `rex restore` to use it.
  
  **The bug.** `snapshotPRDTree` named its backup directory `prd_tree_<raw ISO-8601 timestamp>`. ISO-8601 puts colons in the time component (`2026-08-05T17:27:18.959Z`), and `:` is illegal in Windows filenames — reserved for drive letters and NTFS alternate data streams. So the snapshot `mkdir`/`cp` failed with `EINVAL` on **every** Windows invocation. Because `add` and `reshape` caught the failure, printed a one-line warning, and continued anyway, Windows users had been running destructive tree rewrites with no rollback point at all — and the only signal was a line of text above the normal command output. Snapshot ids are now colon-free (`2026-08-05T17-27-18.959Z`), encoded positionally so lexicographic order still equals chronological order, which `getAvailableBackups` depends on.
  
  **Restore was also broken.** `restoreFromBackup` documented "Remove current tree if it exists" but performed a recursive copy with `force: true` — an overlay, not a replace. Any file a command created after the snapshot survived the "rollback", leaving a tree that was the union of both states rather than the point in time it claimed to be. Restore now stages the snapshot beside the live tree and swaps it in, so a partial failure can never leave the project with no PRD.
  
  **Snapshots are now reachable.** Added `rex restore`: lists available snapshots with timestamps and file counts, restores via `--latest` or `--id=<id>`, and confirms before replacing the tree (`--yes` to skip, `--format=json` for scripts). Previously the snapshots existed on disk with no supported way to use them, and the failure hint suggested `cp -r` — a command that does not exist in cmd.exe or PowerShell.
  
  **Coverage widened.** A new `cli/snapshot-guard.ts` centralizes the pre-command snapshot and now guards `add`, `reshape`, `prune`, `reorganize`, `remove`, `move`, and `fix`. The guard **fails closed**: if a snapshot cannot be created, the command aborts rather than rewriting the tree unprotected. `--no-snapshot` opts out for read-only filesystems and CI. `update` is deliberately excluded — it is on hench's hot path and a full-tree copy per task-status transition would be a significant regression.
  
  Regression tests assert the snapshot directory contains none of Windows' reserved characters, that encoded ids stay chronologically sortable, that restore accepts both an encoded id and a raw ISO timestamp (for snapshots written before this fix), and that restore replaces rather than overlays.
- Updated dependencies [[`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056), [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84)]:
  - @n-dx/llm-client@0.5.0

## 0.4.6

### Patch Changes

- [#268](https://github.com/en-dash-consulting/n-dx/pull/268) [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Exclude `.claude/`, `.codex/`, `CLAUDE.md`, and `AGENTS.md` from the rex doc scanner. These are AI assistant tool config directories and generated instruction files that were being ingested as PRD proposals.

- [#269](https://github.com/en-dash-consulting/n-dx/pull/269) [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482) Thanks [@en-drza](https://github.com/en-drza)! - Introduced animated carolinaBlue loader and aesthetic DX improvements for long-running status and work commands.

- [#239](https://github.com/en-dash-consulting/n-dx/pull/239) [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2) Thanks [@endash-shal](https://github.com/endash-shal)! - Added Google integration

- Updated dependencies [[`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352), [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482), [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2)]:
  - @n-dx/llm-client@0.4.6

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- Updated dependencies [[`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f), [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b)]:
  - @n-dx/llm-client@0.4.5

## 0.4.4

### Patch Changes

- Updated dependencies []:
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

## 0.4.2

### Patch Changes

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

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Allow partial accept inside a recommendation group via
  `rex recommend --accept=hashes:<hash>,<hash>,…`. Findings matching the listed
  hash prefixes are filtered first; the recommendation tree is regenerated from
  just those findings and accepted whole. Lets you keep the one valid finding
  inside a noisy group without forcing acks on the rest or having to take the
  group all-or-nothing.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Make `rex recommend` acknowledgement workflow address-by-hash. Each finding
  now prints with a stable 6-char hash prefix (`[a3f5d8]`) and
  `--acknowledge=<hash|index>,…` accepts either. Hashes are recommended because
  indices renumber after every ack — a planned `--acknowledge=1,5,9` no longer
  goes wrong when the first ack shifts the list.

  Adds `--unacknowledge=<hash|index>,…` to undo prior acknowledgements
  (previously required hand-editing `.rex/acknowledged-findings.json`) and
  `--reason=<category>` to capture _why_ — canonical categories are
  `tool-artifact`, `already-done`, `doesnt-apply`, `over-engineered`,
  `speculative`, and free-form values are also accepted. The recorded reason
  will later let the analyzer mine repeated junk and improve its prompts.

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

- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8)]:
  - @n-dx/llm-client@0.4.2

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

- Updated dependencies [[`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4)]:
  - @n-dx/llm-client@0.4.1

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
  - @n-dx/llm-client@0.4.0

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/llm-client@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- Updated dependencies []:
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.3.1

## 0.3.0

### Patch Changes

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/llm-client@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/llm-client@0.2.3

## 0.2.2

### Patch Changes

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/llm-client@0.2.2

## 0.2.1

### Patch Changes

- [#126](https://github.com/en-dash-consulting/n-dx/pull/126) [`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix ndx work failing when .hench/runs/ directory is missing after a fresh clone. Add generated rex files to .gitignore on init. Exclude source map files from published packages.

- Updated dependencies []:
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
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

- Updated dependencies [[`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82), [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88), [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8)]:
  - @n-dx/llm-client@0.1.9

## 0.1.8

### Patch Changes

- [#31](https://github.com/en-dash-consulting/n-dx/pull/31) [`e83e960`](https://github.com/en-dash-consulting/n-dx/commit/e83e9601f179855b69d49a3557ce1b29bdc082f9) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `ndx add` CLI delegation treating description as directory path, fix `isFullyCompleted` in rex prune to treat deleted children as completed, and rename Claude Code skills with `ndx-` prefix to avoid collisions with builtins.

- Updated dependencies []:
  - @n-dx/llm-client@0.1.8
