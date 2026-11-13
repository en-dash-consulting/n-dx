/**
 * One benchmark batch: start every run of a case at once, taking the host
 * slot around each run only when the case's `slot` flag is set. Spawning is the
 * caller's `launch`, so the slot logic can be driven with fakes.
 */

import { CASES, caseEnv } from "./plan.mjs";
import { settleAll } from "./settle.mjs";

/**
 * @typedef {object} LaunchResult what the caller's run reports; merged into the record
 * @property {number|null} exitCode
 */

/**
 * Run one batch and return its records, in worker order.
 *
 * Cases without `slot` never touch `slotApi`, so their runs start together
 * and compete for the machine; the runner gets `--no-slot` from `runnerArgs`.
 * A slot case acquires once per run and hands the lease to `launch`, whose
 * child runs nested in it.
 *
 * @param {object} args
 * @param {{ caseId: string, fixture: string, repeat: number, batchId: string, worktrees: number }} args.batch
 * @param {string[]} args.worktrees at least `batch.worktrees` paths
 * @param {{ acquireValidationSlot: Function, slotDir: string } | null} args.slotApi required for a slot case
 * @param {AbortSignal} [args.signal]
 * @param {Record<string, string|undefined>} args.baseEnv
 * @param {(run: { worker: number, worktree: string, runKey: string, env: object, lease: object|null }) => Promise<LaunchResult & object>} args.launch
 * @param {() => number} [args.now]
 * @returns {Promise<object[]>}
 */
export async function runBatch({ batch, worktrees, slotApi, signal, baseEnv, launch, now = Date.now }) {
  const takesSlot = CASES[batch.caseId].slot;
  if (takesSlot && !slotApi) throw new Error(`Case ${batch.caseId} takes the host slot, but no slot module was loaded.`);
  const env = caseEnv(batch.caseId, baseEnv);

  const one = async (worktree, worker) => {
    const runKey = `${batch.caseId}-${batch.fixture}-r${batch.repeat}-w${worker}`;
    const record = {
      caseId: batch.caseId,
      fixture: batch.fixture,
      repeat: batch.repeat,
      worker,
      batchId: batch.batchId,
      maxWorkers: env.NDX_TEST_MAX_WORKERS ?? null,
      slot: takesSlot,
      slotTaken: false,
      requestedAt: now(),
    };
    let lease = null;
    if (takesSlot) {
      lease = await slotApi.acquireValidationSlot({ slotDir: slotApi.slotDir, projectDir: worktree, env, signal });
      record.slotTaken = true;
      record.slotNested = lease.nested;
    }
    let result;
    const startedAt = now();
    try {
      result = await launch({ worker, worktree, runKey, env: lease ? lease.childEnv(env) : env, lease });
    } finally {
      if (lease) {
        await lease.release().catch((err) => console.error(`WARNING: could not release the validation slot after ${runKey}: ${err.message}`));
      }
    }
    const endedAt = now();
    return Object.assign(record, {
      startedAt,
      endedAt,
      wallMs: endedAt - record.requestedAt,
      // Queue and exec only mean something for a run that actually waited for the slot.
      queueMs: lease ? lease.queueWaitMs : null,
      execMs: lease ? endedAt - startedAt : null,
      ...result,
    });
  };

  // Every run must have exited before an error reaches cleanup, which removes their worktrees.
  return settleAll(worktrees.slice(0, batch.worktrees).map((worktree, i) => one(worktree, i + 1)));
}
