/**
 * Server-side half of the execute request's run options: the checks that need
 * the project (`src/shared/run-options.ts` holds the shape checks and the
 * key → flag table), and the temp file `contextNotes` travels in.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  remove: () => Promise<void>;
}

/**
 * Write `contextNotes` to a file of its own under the OS temp directory, for
 * `--context-file`. A private directory per run, so two runs never share a
 * name and removal takes nothing else with it.
 */
export async function writeContextNotesFile(notes: string): Promise<ContextNotesFile> {
  const dir = await mkdtemp(join(tmpdir(), "ndx-context-"));
  const path = join(dir, "context-notes.md");
  await writeFile(path, notes, { encoding: "utf-8", mode: 0o600 });
  return { path, remove: () => rm(dir, { recursive: true, force: true }) };
}
