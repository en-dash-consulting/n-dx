/**
 * The paths each other worktree's branch changed against a base, kept across
 * requests.
 *
 * `git diff --name-only <base>...<tip>` depends only on the two commits, so a
 * result keyed by both commit ids can never go stale: a moved base or tip is a
 * new key. Opening the Workspaces board reads every card at once, and each
 * card with a source conflict names the other worktrees; without this, W
 * worktrees ran up to W² diffs per board (#930 review F3).
 *
 * @module web/server/branch-health/diff-cache
 */

/** Entries kept before the least recently used is dropped. */
export const WORKTREE_DIFF_CACHE_MAX = 1024;

/**
 * A size-capped map of in-flight or settled diff results. A pending promise is
 * shared, so concurrent cards run one diff; a failed diff is not kept.
 */
export class WorktreeDiffCache {
  private readonly entries = new Map<string, Promise<readonly string[] | null>>();

  constructor(private readonly max = WORKTREE_DIFF_CACHE_MAX) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * The changed paths between `base` and `tip` (commit ids), from `read` on a
   * miss. `read` answers null when git failed; that answer is returned but
   * forgotten, so the next request asks git again.
   */
  async changed(base: string, tip: string, read: () => Promise<readonly string[] | null>): Promise<readonly string[] | null> {
    const key = `${base}...${tip}`;
    const hit = this.entries.get(key);
    if (hit) {
      // Refresh recency: Map iteration order is the eviction order.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const pending = read();
    this.entries.set(key, pending);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    const forget = () => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    };
    try {
      const result = await pending;
      if (result === null) forget();
      return result;
    } catch (err) {
      forget();
      throw err;
    }
  }
}

/** Shared by every request this server answers. */
export const worktreeDiffs = new WorktreeDiffCache();
