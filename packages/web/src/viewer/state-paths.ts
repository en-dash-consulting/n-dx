/**
 * Where n-dx keeps its state, as repo-relative directories — the viewer's twin.
 *
 * ## Why a twin rather than the resolver
 *
 * `layoutStateNames()` in `@n-dx/llm-client` is the canonical answer. The
 * viewer cannot ask it: `layout.ts` imports `node:fs`, `node:os` and
 * `node:path` at module scope, so pulling it into the browser bundle would not
 * build. This file restates its result, the way `packages/core/layout.js` does
 * for the orchestration tier and `src/export/iso-*.ts` does for the standalone
 * iso skill. `tests/integration/layout-resolver-contract.test.js` pins it to
 * the resolver, so the copies cannot drift apart silently.
 *
 * It sits at `viewer/` top level rather than in `shared/` because both its
 * consumers are viewer views: `shared/` carries a two-consumer-zone rule
 * (`boundary-check.test.ts`), and a single-consumer utility belongs next to
 * its use site. Move it down if the server ever needs the same list.
 *
 * ## Why both layouts, always
 *
 * These are for **classifiers** — code handed a path by an analysis inventory
 * or by a run record's file list, which has to answer "is this n-dx's own
 * state?". Resolving the one layout the project happens to be on would make
 * the answer depend on where the code runs: a `.ndx/` project would stop
 * recognising `.rex/`, and a legacy one would stop recognising `.ndx/rex/`. No
 * project has both shapes — `.ndx/` present *is* the new layout — so matching
 * both is not a false positive waiting to happen.
 *
 * Nothing here *opens* a path. The viewer is handed paths the server already
 * resolved; a writer has to pick one layout and must call the resolver.
 *
 * Forward slashes, because every path these are matched against is a
 * repo-relative path in git's spelling.
 *
 * @see packages/llm-client/src/layout.ts — `layoutStateNames`, the canonical copy
 */

/** Rex PRD state, in both layouts. */
export const REX_STATE_DIRS = [".rex", ".ndx/rex"] as const;

/** Hench agent state, in both layouts. */
export const HENCH_STATE_DIRS = [".hench", ".ndx/hench"] as const;

/** SourceVision analysis output, in both layouts. */
export const SOURCEVISION_STATE_DIRS = [".sourcevision", ".ndx/sourcevision"] as const;

/** Every directory n-dx keeps state in, in both layouts. */
export const ALL_STATE_DIRS: readonly string[] = [
  ...REX_STATE_DIRS,
  ...HENCH_STATE_DIRS,
  ...SOURCEVISION_STATE_DIRS,
];

/** The same directories as path prefixes, ready to match against. */
export const stateDirPrefixes = (dirs: readonly string[]): string[] =>
  dirs.map((dir) => `${dir}/`);
