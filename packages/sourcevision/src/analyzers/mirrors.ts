/**
 * Mirrored trees: a folder that is a near-copy of another folder in the same
 * repository (a legacy `edit/` beside `app/`, a `site_old/` kept next to
 * `site/`). Counted as written, every zone, import, archetype and migration
 * total doubles.
 *
 * {@link markMirrors} finds folder pairs from the inventory's content hashes
 * and sets `mirrorOf` on each file of the copy whose content is identical to
 * the file at the same relative path in the source: those are counted once,
 * in the source, and left out of the structural phases like third-party code
 * (`isOutsideStructure`). A file that differs from its counterpart, or has
 * none, stays first-party: it is where the copy diverged.
 *
 * Detection. The inventory is indexed once (by hash, by path, and by every
 * ancestor folder), so the cost is O(files × path depth) for the indexes, plus
 * O(files in a hash group)² per hash group of at most {@link MAX_GROUP} for
 * candidate pairs, plus, per candidate pair, the size of its smaller root;
 * nothing rescans the inventory per pair:
 *
 * 1. Group files by hash; within a group, each pair of files with the same
 *    name gives a candidate pair of roots: the two paths with their common
 *    trailing segments removed (`app/x/a.php`, `edit/x/a.php` → `app`,
 *    `edit`). A root inside the other is skipped, as are hash groups larger
 *    than {@link MAX_GROUP} (empty files, a licence header copied everywhere).
 * 2. For each candidate pair, the copy is the root whose files are matched at
 *    the higher share; a pair counts when at least {@link MIN_MATCHED} files
 *    match and they are at least {@link MIN_SHARE} of the copy's files. Both
 *    sides above it (an exact copy): the smaller is the copy, then the later
 *    in path order.
 * 3. A root already marked as a copy is never another pair's source.
 *
 * `sourcevision.mirrors` in the project config sets or denies a pair:
 * `{ "edit/": "app/" }` makes `edit/` a copy of `app/` whatever the share;
 * `{ "edit/": false }` never treats `edit/` as a copy.
 *
 * @module sourcevision/analyzers/mirrors
 */

import type { FileEntry } from "../schema/index.js";
import { divergentRoots } from "../util/paths.js";

/** Smallest share of the copy's files that must be identical. */
export const MIN_SHARE = 0.5;
/** Fewest identical files for a pair to count. */
export const MIN_MATCHED = 10;
/** Hash groups larger than this give no candidate pairs. */
const MAX_GROUP = 20;

/** One mirrored pair, for the analyze log. */
export interface MirrorPair {
  /** The copy's root, without a trailing slash. */
  readonly mirror: string;
  /** The source's root. */
  readonly source: string;
  /** Files of the copy identical to their counterpart, so marked. */
  readonly matched: number;
  /** All files under the copy's root. */
  readonly files: number;
  /** Set by `sourcevision.mirrors` rather than detected. */
  readonly configured?: true;
}

/** `sourcevision.mirrors`: copy root → source root, or `false` to deny. */
export type MirrorConfig = Readonly<Record<string, string | false>>;

const trimSlash = (dir: string) => dir.replace(/^\.\//, "").replace(/\/+$/, "");

const under = (path: string, root: string) => path.startsWith(`${root}/`);
const nested = (a: string, b: string) => a === b || under(a, b) || under(b, a);

/**
 * The inventory's files with `mirrorOf` set to the identical counterpart on
 * each mirror-copy file and cleared on every other, in the same order, and
 * the pairs found.
 */
export function markMirrors(files: readonly FileEntry[], config: MirrorConfig = {}): { files: FileEntry[]; pairs: MirrorPair[] } {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const denied = new Set(Object.entries(config).filter(([, v]) => v === false).map(([k]) => trimSlash(k)));
  const forced = Object.entries(config)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .map(([mirror, source]) => ({ mirror: trimSlash(mirror), source: trimSlash(source) }));

  // 1. Candidate root pairs from identical files of the same name.
  const byHash = new Map<string, FileEntry[]>();
  for (const f of files) {
    let group = byHash.get(f.hash);
    if (group === undefined) byHash.set(f.hash, (group = []));
    group.push(f);
  }
  const candidates = new Map<string, { a: string; b: string }>();
  for (const group of byHash.values()) {
    if (group.length < 2 || group.length > MAX_GROUP) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const roots = divergentRoots(group[i].path, group[j].path);
        if (roots === undefined || nested(roots[0], roots[1])) continue;
        const [a, b] = roots[0] < roots[1] ? roots : [roots[1], roots[0]];
        candidates.set(`${a}\0${b}`, { a, b });
      }
    }
  }

  // 2. Score each candidate: files of one root identical to the same relative path under the other.
  //    The inventory is indexed once by every ancestor folder, so a root's files are one lookup.
  const byRoot = new Map<string, FileEntry[]>();
  for (const f of files) {
    for (let slash = f.path.indexOf("/"); slash !== -1; slash = f.path.indexOf("/", slash + 1)) {
      const root = f.path.slice(0, slash);
      let list = byRoot.get(root);
      if (list === undefined) byRoot.set(root, (list = []));
      list.push(f);
    }
  }
  const NONE: readonly FileEntry[] = [];
  const countUnder = (root: string) => (byRoot.get(root) ?? NONE).length;
  const matchedFiles = (mirror: string, source: string): FileEntry[] =>
    (byRoot.get(mirror) ?? NONE).filter((f) => {
      const counterpart = byPath.get(`${source}/${f.path.slice(mirror.length + 1)}`);
      return counterpart !== undefined && counterpart.hash === f.hash;
    });
  const scored: (MirrorPair & { share: number })[] = [];
  for (const { a, b } of candidates.values()) {
    const aFiles = countUnder(a);
    const bFiles = countUnder(b);
    // A file of `a` matches one of `b` at the same relative path and hash exactly when that file
    // of `b` matches it back, so both sides match the same count: walk the smaller root.
    const aMatched = aFiles <= bFiles ? matchedFiles(a, b).length : matchedFiles(b, a).length;
    const bMatched = aMatched;
    const aShare = aFiles === 0 ? 0 : aMatched / aFiles;
    const bShare = bFiles === 0 ? 0 : bMatched / bFiles;
    const bothCopies = aShare >= MIN_SHARE && bShare >= MIN_SHARE;
    const aIsCopy = bothCopies ? aFiles < bFiles || (aFiles === bFiles && a > b) : aShare > bShare;
    const [mirror, source, matched, total, share] = aIsCopy ? [a, b, aMatched, aFiles, aShare] : [b, a, bMatched, bFiles, bShare];
    if (matched < MIN_MATCHED || share < MIN_SHARE || denied.has(mirror)) continue;
    scored.push({ mirror, source, matched, files: total, share });
  }
  scored.sort((x, y) => y.matched - x.matched || (x.mirror < y.mirror ? -1 : 1));

  // 3. Configured pairs first, then detected ones; a copy is never a source, nor a copy twice.
  const pairs: MirrorPair[] = [];
  const copies = new Set<string>();
  for (const { mirror, source } of forced) {
    if (denied.has(mirror) || nested(mirror, source)) continue;
    pairs.push({ mirror, source, matched: matchedFiles(mirror, source).length, files: countUnder(mirror), configured: true });
    copies.add(mirror);
  }
  for (const pair of scored) {
    if (copies.has(pair.mirror) || [...copies].some((c) => nested(c, pair.source) || nested(c, pair.mirror))) continue;
    pairs.push({ mirror: pair.mirror, source: pair.source, matched: pair.matched, files: pair.files });
    copies.add(pair.mirror);
  }

  const counterpartOf = new Map<string, string>();
  for (const { mirror, source } of pairs) {
    for (const f of matchedFiles(mirror, source)) counterpartOf.set(f.path, `${source}/${f.path.slice(mirror.length + 1)}`);
  }
  const marked = files.map((file) => {
    const { mirrorOf: _old, ...rest } = file;
    const counterpart = counterpartOf.get(file.path);
    return counterpart === undefined ? (rest as FileEntry) : { ...rest, mirrorOf: counterpart };
  });
  return { files: marked, pairs: pairs.sort((x, y) => (x.mirror < y.mirror ? -1 : x.mirror > y.mirror ? 1 : 0)) };
}
