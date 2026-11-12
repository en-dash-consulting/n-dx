/**
 * Wait for every promise in a batch, then fail with the first rejection.
 *
 * `Promise.all` rejects as soon as one run does. In case D a Ctrl-C makes
 * the runs still waiting for the slot reject at once while the run holding
 * it is still stopping, and cleanup would then remove its worktree under it.
 *
 * @template T
 * @param {Promise<T>[]} promises
 * @returns {Promise<T[]>}
 */
export async function settleAll(promises) {
  const results = await Promise.allSettled(promises);
  const rejected = results.find((r) => r.status === "rejected");
  if (rejected) throw rejected.reason;
  return results.map((r) => r.value);
}
