/**
 * Server-side half of the execute request's run options: the checks that need
 * the project (`src/shared/run-options.ts` holds the shape checks and the
 * key → flag table), and the temp file `contextNotes` travels in.
 */

import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRunOptions, type RunOptionsCheck } from "../shared/index.js";
import { validateProviderForVendor } from "./hench-config-fields.js";
import { resolveActiveVendor, validateCatalogModel } from "./routes-llm.js";

/**
 * Check an execute request's `options`: the allow-list and shapes, then the
 * model against the active vendor's catalog and the provider against what
 * the vendor supports. The first problem is reported, naming its key.
 */
export async function validateRunOptions(projectDir: string, input: unknown): Promise<RunOptionsCheck> {
  const checked = checkRunOptions(input);
  if (!checked.ok) return checked;
  const { options } = checked;
  const vendor = resolveActiveVendor(projectDir);

  for (const key of ["model", "reviewModel"] as const) {
    const model = options[key];
    if (model === undefined) continue;
    const error = await validateCatalogModel(projectDir, vendor, model);
    if (error) return { ok: false, key, error: `Run option "${key}": ${error}` };
  }
  if (options.provider !== undefined) {
    const error = validateProviderForVendor(options.provider, vendor);
    if (error) return { ok: false, key: "provider", error: `Run option "provider": ${error}` };
  }
  return { ok: true, options };
}

/** A `contextNotes` file and how to remove it. */
export interface ContextNotesFile {
  path: string;
  /** Removes the file's directory; tracked for {@link settleContextNotesRemovals}. */
  remove: () => Promise<void>;
}

const CONTEXT_DIR_PREFIX = "ndx-context-";

/** Removals started and not yet finished, so shutdown can wait for them. */
const pendingRemovals = new Set<Promise<void>>();

/**
 * Write `contextNotes` to a file of its own under the OS temp directory, for
 * `--context-file`. A private directory per run, so two runs never share a
 * name and removal takes nothing else with it. A failed write removes the
 * directory it made before rethrowing.
 */
export async function writeContextNotesFile(notes: string): Promise<ContextNotesFile> {
  const dir = await mkdtemp(join(tmpdir(), CONTEXT_DIR_PREFIX));
  const path = join(dir, "context-notes.md");
  try {
    await writeFile(path, notes, { encoding: "utf-8", mode: 0o600 });
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    path,
    remove: () => {
      const removal: Promise<void> = rm(dir, { recursive: true, force: true }).finally(() => {
        pendingRemovals.delete(removal);
      });
      pendingRemovals.add(removal);
      return removal;
    },
  };
}

/**
 * Wait for context-file removals in flight. Yields once first, so a removal a
 * just-ended run is about to start is counted. Never rejects: callers log
 * their own removal failures.
 */
export async function settleContextNotesRemovals(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.allSettled([...pendingRemovals]);
}

/** Directories this old are left over from a server that died mid-run. */
export const STALE_CONTEXT_DIR_MS = 24 * 60 * 60 * 1000;

/**
 * Remove `ndx-context-*` directories under `root` last modified more than
 * `maxAgeMs` ago. Returns how many were removed. An entry that cannot be
 * handled is skipped with a warning: another process may own it.
 */
export async function sweepStaleContextNotes(
  maxAgeMs: number = STALE_CONTEXT_DIR_MS,
  root: string = tmpdir(),
  now: number = Date.now(),
): Promise<number> {
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(CONTEXT_DIR_PREFIX)) continue;
    const dir = join(root, entry.name);
    try {
      if (now - (await stat(dir)).mtimeMs <= maxAgeMs) continue;
      await rm(dir, { recursive: true, force: true });
      removed++;
    } catch (err) {
      console.warn(`[hench] could not sweep stale context directory ${dir}: ${(err as Error).message}`);
    }
  }
  return removed;
}
